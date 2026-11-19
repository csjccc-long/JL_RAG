import asyncio

from memory.backends.hindsight import HindsightBackend
from memory.config import HindsightSettings


def run(coro):
    return asyncio.run(coro)


def backend(tmp_path, **overrides):
    settings = HindsightSettings(db_path=str(tmp_path / "hindsight.db"))
    # A queued write is drained by a worker task bound to the caller's event
    # loop, which asyncio.run closes before it can finish. These tests assert
    # what was stored, so they take the inline path.
    overrides.setdefault("retain_async", False)
    return HindsightBackend(settings, **overrides)


def test_status_reports_the_native_engine(tmp_path):
    status = backend(tmp_path).status()
    assert status["backend"] == "native"
    assert status["healthy"] is True
    assert status["db_path"].endswith("hindsight.db")
    assert status["enabled"] is True


def test_remember_extracts_facts_and_recall_finds_them(tmp_path):
    memory = backend(tmp_path)
    run(
        memory.remember(
            namespace="proj",
            user_text="我们决定使用 pgvector 存储向量数据，因为它的运维成本更低。",
            assistant_text="好的，记下了这个决定。",
            session_id="sess-1",
            metadata={"tenant_id": "u1", "chat_id": "chat-9"},
        )
    )
    records = run(memory.recall(namespace="proj", query="pgvector 向量", limit=3, tenant_id="u1"))
    assert records, "the extracted fact must be recallable"
    assert any("pgvector" in record.text for record in records)
    assert records[0].source == "hindsight"
    assert records[0].metadata["type"] in {"world", "assistant"}


def test_same_document_is_not_stored_twice(tmp_path):
    memory = backend(tmp_path)
    kwargs = dict(
        namespace="proj",
        user_text="部署使用 docker compose 启动服务。",
        assistant_text="明白。",
        session_id="s",
        metadata={"tenant_id": "u1", "chat_id": "chat-1"},
    )
    run(memory.remember(**kwargs))
    run(memory.remember(**kwargs))
    stats = memory.engine.stats("u1", "proj")
    assert stats["documents"] == 1
    assert stats["facts"] == 1


def test_recall_is_scoped_to_the_tenant(tmp_path):
    memory = backend(tmp_path)
    run(
        memory.remember(
            namespace="proj",
            user_text="Alice 的合同在三月到期。",
            assistant_text="记录完成。",
            metadata={"tenant_id": "alice"},
        )
    )
    assert run(memory.recall(namespace="proj", query="合同", limit=3, tenant_id="bob")) == []
    assert run(memory.recall(namespace="proj", query="合同", limit=3, tenant_id="alice"))


def test_empty_query_returns_nothing(tmp_path):
    assert run(backend(tmp_path).recall(namespace="proj", query="  ", limit=5)) == []


def test_remember_without_tenant_still_stores(tmp_path):
    memory = backend(tmp_path)
    run(memory.remember(namespace="proj", user_text="用户名是 chen。", assistant_text="好。"))
    assert memory.engine.stats("", "proj")["facts"] == 1


def test_consolidation_runs_after_enough_facts(tmp_path):
    memory = backend(tmp_path, consolidate_after=2)
    run(
        memory.remember(
            namespace="proj",
            user_text="第一件事：项目使用 SQLite 存储。第二件事：向量维度是 384。",
            assistant_text="收到。",
            metadata={"tenant_id": "u1"},
        )
    )
    assert memory.engine.stats("u1", "proj")["facts"] >= 2


def test_bank_config_is_parsed_for_the_console(tmp_path):
    engine = backend(tmp_path).engine
    engine.create_bank("u1", "proj", name="Project")
    engine.store.patch_bank("u1", "proj", mission="remember decisions", config={"k": 1})
    bank = engine.store.get_bank("u1", "proj")
    assert bank["name"] == "Project"
    assert bank["mission"] == "remember decisions"
    assert bank["config"] == {"k": 1}


def test_export_and_import_keep_every_track(tmp_path):
    engine = backend(tmp_path).engine
    engine.create_bank("u1", "proj", name="Project")
    engine.create_page("u1", "proj", title="Decisions", content="Use SQLite", tags=["arch"])
    engine.add_directive("u1", "proj", "Prefer short answers", priority=2)
    run(
        backend(tmp_path).remember(
            namespace="proj",
            user_text="项目使用 SQLite 存储记忆。",
            assistant_text="好的。",
            metadata={"tenant_id": "u1"},
        )
    )
    payload = engine.export_bank("u1", "proj")
    assert payload["pages"] and payload["directives"] and payload["memories"]

    other = backend(tmp_path / "other").engine
    other.import_bank("u2", "copy", payload)
    assert other.stats("u2", "copy")["facts"] == 1
    assert other.pages("u2", "copy")[0]["title"] == "Decisions"
    assert other.directives("u2", "copy")[0]["content"] == "Prefer short answers"
    assert other.store.get_bank("u2", "copy")["name"] == "Project"


def test_document_detail_returns_the_retained_text(tmp_path):
    memory = backend(tmp_path)
    run(
        memory.remember(
            namespace="proj",
            user_text="项目使用 pgvector 存储向量。",
            assistant_text="已记录。",
            metadata={"tenant_id": "u1", "chat_id": "chat-7"},
        )
    )
    document = memory.engine.get_document("u1", "proj", "chat-7")
    assert document is not None
    assert "pgvector" in document["content"]
    assert document["document_id"] == "chat-7"
    assert memory.engine.get_document("u1", "proj", "missing") is None


def test_observations_inline_their_source_facts(tmp_path):
    from memory.hindsight.store import Unit

    engine = backend(tmp_path).engine
    engine.store.insert_unit(
        Unit(
            id="fact_1",
            tenant_id="u1",
            bank_id="proj",
            text="用户偏好简短回答",
            mentioned_at="2026-01-01T00:00:00+00:00",
        ),
        "",
        None,
    )
    engine.store.insert_unit(
        Unit(
            id="obs_1",
            tenant_id="u1",
            bank_id="proj",
            text="用户偏好简洁的沟通风格",
            kind="observation",
            source_fact_ids=["fact_1"],
            tags=["preference"],
        ),
        "",
        None,
    )

    tree = engine.observations("u1", "proj")
    observation = tree["groups"][0]["observations"][0]
    assert observation["id"] == "obs_1"
    assert observation["evidence"][0]["id"] == "fact_1"
    assert observation["evidence"][0]["text"] == "用户偏好简短回答"

