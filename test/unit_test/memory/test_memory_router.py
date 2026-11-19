import asyncio
import inspect
import os
from pathlib import Path
from types import SimpleNamespace

from memory.backends.base import MemoryRecord, build_prompt_block
from memory.backends.hindsight import HindsightBackend
from memory.config import HindsightSettings, Mem0Settings, MemorySettings, normalize_mode
from memory.router import MemoryRouter, infer_mode, project_bank


class RecordingBackend:
    name = "recording"

    def __init__(self):
        self.recalls = []
        self.writes = []
        self.records = [MemoryRecord(text="上次讨论过 JWT 登录", score=0.9, source="test")]

    async def recall(self, *, namespace, query, limit, tenant_id=""):
        self.recalls.append((namespace, query, limit))
        return self.records

    async def remember(self, *, namespace, user_text, assistant_text, session_id="", metadata=None):
        self.writes.append((namespace, user_text, assistant_text, session_id))


def settings(**overrides):
    base = dict(
        default_mode="auto",
        prompt_chars=900,
        recall_limit=5,
        mem0=Mem0Settings(),
        hindsight=HindsightSettings(project=""),
    )
    base.update(overrides)
    return MemorySettings(**base)


def dialog(prompt_config=None, kb_ids=None, name="assistant"):
    return SimpleNamespace(prompt_config=prompt_config or {}, kb_ids=kb_ids or [], name=name)


def run(coro):
    return asyncio.run(coro)


def test_explicit_mode_beats_preset_and_default():
    router = MemoryRouter(settings(default_mode="work"))
    dia = dialog({"memory_mode": "chat"}, kb_ids=["kb"])
    assert router.resolve_mode(explicit="work", dialog=dia) == "work"
    assert router.resolve_mode(explicit="chat", dialog=dia) == "chat"


def test_preset_is_used_when_request_has_no_mode():
    router = MemoryRouter(settings(default_mode="work"))
    dia = dialog({"memory_mode": "chat"})
    assert router.resolve_mode(dialog=dia) == "chat"


def test_auto_always_picks_the_free_chat_backend():
    router = MemoryRouter(settings())

    # Work runs the Hindsight engine and costs LLM tokens, so auto never
    # reaches for it, not even for knowledge-base assistants.
    assert router.resolve_mode(dialog=dialog(kb_ids=["kb1"])) == "chat"
    assert router.resolve_mode(dialog=dialog(kb_ids=[])) == "chat"
    assert infer_mode(dialog(kb_ids=["kb1"])) == "chat"


def test_off_short_circuits_recall_and_write():
    router = MemoryRouter(settings())
    assert router.resolve_mode(explicit="off") == "off"
    assert run(router.context_block(mode="off", namespace="x", query="q")) == ""

    async def scenario():
        router.remember(mode="off", namespace="x", user_text="hello", assistant_text="hi")
        await router.drain()

    run(scenario())


def test_context_block_uses_recalled_records():
    backend = RecordingBackend()
    router = MemoryRouter(settings(), hindsight=backend)
    block = run(router.context_block(mode="work", namespace="work-proj", query="JWT"))
    assert "上次讨论过 JWT 登录" in block
    assert backend.recalls == [("work-proj", "JWT", 5)]


def test_remember_dispatches_to_the_mode_backend():
    hindsight, mem0 = RecordingBackend(), RecordingBackend()
    router = MemoryRouter(settings(), hindsight=hindsight, mem0=mem0)

    async def scenario():
        router.remember(mode="work", namespace="work-proj", user_text="q1", assistant_text="a1", session_id="s")
        router.remember(mode="chat", namespace="user-1", user_text="q2", assistant_text="a2")
        await router.drain()

    run(scenario())
    assert hindsight.writes == [("work-proj", "q1", "a1", "s")]
    assert mem0.writes == [("user-1", "q2", "a2", "")]


def test_work_namespace_is_one_bank_per_project():
    router = MemoryRouter(settings(hindsight=HindsightSettings(project="E:/work/repo")))
    assert router.namespace_for(mode="work") == project_bank("E:/work/repo")
    assert router.namespace_for(mode="work") == "work-" + project_bank("E:/work/repo").split("-")[1]

    # Two repositories never share a bank.
    a = router.namespace_for(mode="work", dialog=dialog({"memory_project": "E:/a"}))
    b = router.namespace_for(mode="work", dialog=dialog({"memory_project": "E:/b"}))
    assert a != b

    # The assistant's own project wins over the configured default; with
    # neither, the server cwd names the bank.
    assert router.namespace_for(
        mode="work", dialog=dialog({"memory_project": "E:/cfg"})
    ) == project_bank("E:/cfg")
    assert MemoryRouter(settings()).namespace_for(mode="work") == project_bank(os.getcwd())


def test_namespace_chat_uses_user_id():
    router = MemoryRouter(settings())
    assert router.namespace_for(mode="chat", user_id="user-42") == "user-42"
    assert router.namespace_for(mode="chat", user_id="") == "anonymous"


def test_build_prompt_block_respects_char_limit():
    records = [MemoryRecord(text="x" * 300, score=1.0) for _ in range(10)]
    block = build_prompt_block(records, char_limit=400)
    assert block
    assert len(block) <= 400


def test_hindsight_is_not_a_mode_any_more():
    router = MemoryRouter(settings())
    # Work mode runs the Hindsight engine now, so the old value maps onto it
    # instead of silently falling back to auto.
    assert normalize_mode("hindsight") == "work"
    assert router.resolve_mode(explicit="hindsight") == "work"
    assert router.resolve_mode(dialog=dialog({"memory_mode": "hindsight"})) == "work"


def test_every_backend_accepts_the_tenant_id_router_sends():
    # The router passes tenant_id to every backend. A backend that does not
    # accept it raises TypeError, which recall() swallows, silently disabling
    # that mode's memory.
    for backend in (HindsightBackend,):
        assert "tenant_id" in inspect.signature(backend.recall).parameters, backend.__name__


def test_work_mode_writes_and_reads_through_the_engine(tmp_path):
    store_settings = HindsightSettings(
        db_path=str(tmp_path / "hindsight.db"),
        retain_async=False,
        consolidate_after=0,
    )
    router = MemoryRouter(
        settings(hindsight=store_settings),
        hindsight=HindsightBackend(store_settings),
    )
    namespace = router.namespace_for(
        mode="work", dialog=dialog({"memory_project": str(Path(tmp_path) / "proj")})
    )

    async def scenario():
        router.remember(
            mode="work",
            namespace=namespace,
            user_text="请记住 JWT 登录方案",
            assistant_text="已记录 JWT 登录方案。",
            session_id="s1",
        )
        await router.drain()
        block = await router.context_block(mode="work", namespace=namespace, query="JWT 登录")
        # Another project's bank must stay empty.
        other = await router.context_block(mode="work", namespace=project_bank("E:/other"), query="JWT")
        return block, other

    block, other = run(scenario())
    assert "JWT" in block
    assert other == ""


def test_a_refusal_answer_is_stored_as_the_user_statement_only(tmp_path):
    # RAGFlow answers "not found in the dataset" when retrieval missed. Keeping
    # that answer teaches the bank that the assistant is ignorant, so the turn
    # is retained as the user's own sentence.
    backend = HindsightBackend(
        HindsightSettings(db_path=str(tmp_path / "hindsight.db"), retain_async=False)
    )
    captured = {}

    async def fake_retain(tenant_id, bank_id, content, **kwargs):
        captured["content"] = content

    backend.engine.retain = fake_retain  # type: ignore[method-assign]

    run(
        backend.remember(
            namespace="work-1",
            user_text="部署分支是 release/2026。",
            assistant_text="The answer you are looking for is not found in the dataset!",
            metadata={"tenant_id": "t1"},
        )
    )
    assert captured["content"] == "User: 部署分支是 release/2026。"

    run(
        backend.remember(
            namespace="work-1",
            user_text="部署分支是 release/2026。",
            assistant_text="记住了，发布脚本是 ./scripts/deploy.sh。",
            metadata={"tenant_id": "t1"},
        )
    )
    assert "Assistant: 记住了" in captured["content"]
