import asyncio

from memory.backends.hindsight import HindsightBackend
from memory.config import HindsightSettings


class FixedFacts:
    """A model stub: every call returns the facts the test cares about."""

    def __init__(self, facts):
        self.facts = facts

    async def chat(self, system, user, *, max_tokens=1200):  # noqa: ARG002
        import json

        return json.dumps({"facts": self.facts})

    async def embed(self, texts):
        return []


def run(coro):
    return asyncio.run(coro)


def engine_at(tmp_path, facts):
    memory = HindsightBackend(HindsightSettings(db_path=str(tmp_path / "hindsight.db")),
                              retain_async=False)
    memory.providers = lambda tenant_id: FixedFacts(facts)
    return memory


def test_a_restated_fact_corroborates_instead_of_duplicating(tmp_path):
    memory = engine_at(tmp_path, [{"what": "项目的缓存使用 Redis 集群，端口为 6380。"}])
    run(memory.remember(namespace="proj", assistant_text="", user_text="记住：我们项目的缓存使用 Redis 集群。",
                        metadata={"tenant_id": "u1", "chat_id": "chat-1"}))
    memory.providers = lambda tenant_id: FixedFacts(
        [{"what": "我们项目的缓存使用的是 Redis 集群，端口 6380。"}])
    run(memory.remember(namespace="proj", assistant_text="", user_text="我们项目的缓存用什么？",
                        metadata={"tenant_id": "u1", "chat_id": "chat-2"}))

    facts = memory.engine.store.units("u1", "proj", kind="fact")
    assert len(facts) == 1, [unit.text for unit in facts]
    assert facts[0].proof_count == 2


def test_two_different_facts_sharing_words_are_kept(tmp_path):
    memory = engine_at(tmp_path, [{"what": "缓存用 Redis，端口 6380。"}])
    run(memory.remember(namespace="proj", assistant_text="", user_text="缓存怎么部署？",
                        metadata={"tenant_id": "u1", "chat_id": "a"}))
    memory.providers = lambda tenant_id: FixedFacts([{"what": "数据库用 MySQL，端口 3306。"}])
    run(memory.remember(namespace="proj", assistant_text="", user_text="数据库怎么部署？",
                        metadata={"tenant_id": "u1", "chat_id": "b"}))

    texts = [unit.text for unit in memory.engine.store.units("u1", "proj", kind="fact")]
    assert len(texts) == 2

class FixedFactsWithVectors:
    """A model stub that also hands back the embedding it 'computed'."""

    def __init__(self, facts, vector):
        self.facts = facts
        self.vector = vector

    async def chat(self, system, user, *, max_tokens=1200):  # noqa: ARG002
        import json

        return json.dumps({"facts": self.facts})

    async def embed(self, texts):
        return [list(self.vector) for _ in texts]


def test_a_rephrased_fact_is_folded_by_meaning(tmp_path):
    memory = engine_at(tmp_path, [{"what": "发布走 ./scripts/deploy.sh。"}])
    memory.providers = lambda tenant_id: FixedFactsWithVectors(
        [{"what": "发布走 ./scripts/deploy.sh。"}], [1.0, 0.0, 0.0])
    run(memory.remember(namespace="proj", assistant_text="", user_text="怎么发布？",
                        metadata={"tenant_id": "u1", "chat_id": "a"}))

    # Different words, same meaning: only the embedding can tell these apart.
    memory.providers = lambda tenant_id: FixedFactsWithVectors(
        [{"what": "上线要用 deploy 脚本。"}], [1.0, 0.0, 0.0])
    run(memory.remember(namespace="proj", assistant_text="", user_text="上线流程？",
                        metadata={"tenant_id": "u1", "chat_id": "b"}))

    facts = memory.engine.store.units("u1", "proj", kind="fact")
    assert len(facts) == 1, [unit.text for unit in facts]
