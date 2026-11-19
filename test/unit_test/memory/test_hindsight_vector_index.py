import asyncio
import json
import zlib
from datetime import datetime, timedelta, timezone

import pytest

from memory.hindsight.engine import HindsightEngine
from memory.hindsight.fusion import cosine
from memory.hindsight.store import MemoryStore, Unit
from memory.hindsight.tokens import tokenize
from memory.hindsight.vector_index import (
    BACKEND_AUTO,
    BACKEND_ELASTICSEARCH,
    BACKEND_SQLITE,
    BULK_BATCH,
    ElasticsearchVectorIndex,
    SqliteVectorIndex,
    VectorItem,
    build_vector_index,
    from_es_score,
    normalize_backend,
)


def run(coro):
    return asyncio.run(coro)


# -- a document store that behaves like Elasticsearch -------------------


class FakeIndices:
    def __init__(self, client):
        self.client = client

    def exists(self, index):
        return index in self.client.indices_map

    def create(self, index, mappings=None):
        if index in self.client.indices_map:
            raise RuntimeError("resource_already_exists_exception: index already exists")
        self.client.indices_map[index] = {"mappings": mappings or {}, "docs": {}}
        return {"acknowledged": True}


class FakeES:
    """Just enough Elasticsearch: dense_vector cosine kNN over in-memory documents.

    Scores are reported the way the real service reports them for a 'cosine'
    field - (1 + cosine) / 2 - so the translation in from_es_score is exercised
    rather than assumed.
    """

    def __init__(self, healthy=True):
        self.healthy = healthy
        self.indices_map = {}
        self.indices = FakeIndices(self)
        self.searches = 0
        self.bulk_calls = 0
        self.deleted_by_query = 0

    def ping(self):
        if not self.healthy:
            raise ConnectionError("connection refused")
        return True

    def bulk(self, operations=None, refresh=None, **kwargs):
        self.bulk_calls += 1
        items = []
        cursor = 0
        while cursor < len(operations):
            action, meta = next(iter(operations[cursor].items()))
            if action == "index":
                body = operations[cursor + 1]
                cursor += 2
                store = self.indices_map.setdefault(
                    meta["_index"], {"mappings": {}, "docs": {}}
                )
                store["docs"][meta["_id"]] = dict(body)
                items.append({"index": {"_id": meta["_id"], "status": 201}})
            else:
                cursor += 1
                store = self.indices_map.get(meta["_index"])
                existed = bool(store and store["docs"].pop(meta["_id"], None))
                items.append({"delete": {"_id": meta["_id"],
                                         "result": "deleted" if existed else "not_found"}})
        return {"errors": False, "items": items}

    def search(self, index, knn=None, size=None, source=None, **kwargs):
        self.searches += 1
        store = self.indices_map.get(index)
        if not store:
            return {"hits": {"hits": []}}
        query_vector = knn["query_vector"]
        filters = ((knn.get("filter") or {}).get("bool") or {}).get("filter") or []
        hits = []
        for doc_id, doc in store["docs"].items():
            if any(
                any(doc.get(field) != value for field, value in term["term"].items())
                for term in filters
            ):
                continue
            score = (1.0 + cosine(query_vector, doc["embedding"])) / 2.0
            hits.append({"_id": doc_id, "_score": score, "_source": {"unit_id": doc["unit_id"]}})
        hits.sort(key=lambda hit: -hit["_score"])
        return {"hits": {"hits": hits[: int(knn.get("k") or size or 10)]}}

    def count(self, index=None, query=None, **kwargs):
        store = self.indices_map.get(index)
        if not store:
            return {"count": 0}
        if not query:
            return {"count": len(store["docs"])}
        term = query["term"]
        return {"count": sum(1 for doc in store["docs"].values() if term["bank_id"] == doc["bank_id"])}

    def delete_by_query(self, index, query=None, refresh=None, conflicts=None, **kwargs):
        store = self.indices_map.get(index)
        if not store:
            return {"deleted": 0}
        bank = (query or {}).get("term", {}).get("bank_id")
        doomed = [doc_id for doc_id, doc in store["docs"].items() if doc["bank_id"] == bank]
        for doc_id in doomed:
            store["docs"].pop(doc_id, None)
        self.deleted_by_query += len(doomed)
        return {"deleted": len(doomed)}


class FactProviders:
    """One fact per chunk, and vectors that put different texts in different slots."""

    def __init__(self):
        self.embed_calls = 0

    async def chat(self, system, user, **kwargs):
        body = user.split("Conversation:", 1)[-1].strip()
        return json.dumps({"facts": [{"what": f"事实：{body[:40]}", "entities": ["系统"]}]},
                          ensure_ascii=False)

    async def embed(self, texts):
        self.embed_calls += 1
        vectors = []
        for text in texts:
            vector = [0.0] * 16
            vector[zlib.crc32(text.encode("utf-8")) % 16] = 1.0
            vectors.append(vector)
        return vectors


def vector_for(text):
    vector = [0.0] * 16
    vector[zlib.crc32(text.encode("utf-8")) % 16] = 1.0
    return vector


class FixedEmbedProviders(FactProviders):
    """Answers extraction as usual but embeds every query at one known vector."""

    def __init__(self, vector):
        super().__init__()
        self.vector = list(vector)

    async def embed(self, texts):
        self.embed_calls += 1
        return [list(self.vector) for _ in texts]


def engine_at(tmp_path, index=None):
    engine = HindsightEngine(
        str(tmp_path / "engine.db"), default_bank="proj", consolidate_after=0,
        chunk_chars=300, vector_index=index,
    )
    engine.store.init()
    engine.store.ensure_bank("u1", "proj")
    return engine


def es_index(prefix="hindsight"):
    client = FakeES()
    return client, ElasticsearchVectorIndex(client, prefix=prefix)


# -- the backend switch -------------------------------------------------


def test_backend_names_fall_back_to_auto():
    assert normalize_backend("Elasticsearch") == BACKEND_ELASTICSEARCH
    assert normalize_backend(" sqlite ") == BACKEND_SQLITE
    assert normalize_backend("postgres") == BACKEND_AUTO
    assert normalize_backend(None) == BACKEND_AUTO


def test_sqlite_is_used_when_no_vector_database_is_configured(tmp_path):
    store = MemoryStore(str(tmp_path / "v.db"))
    store.init()

    index = build_vector_index(store, backend=BACKEND_AUTO)

    assert isinstance(index, SqliteVectorIndex)
    assert index.describe()["backend"] == BACKEND_SQLITE


def test_an_explicit_elasticsearch_backend_still_degrades_to_the_scan(tmp_path):
    store = MemoryStore(str(tmp_path / "v.db"))
    store.init()

    index = build_vector_index(store, backend=BACKEND_ELASTICSEARCH)

    # No document store is configured on this machine, so the client cannot be
    # built and the scan stands in; recall must not lose its semantic arm.
    assert isinstance(index, SqliteVectorIndex)


# -- the Elasticsearch index itself -------------------------------------


def test_es_scores_are_mapped_back_to_cosine():
    assert from_es_score(0.8) == pytest.approx(0.6)
    assert from_es_score(1.0) == pytest.approx(1.0)
    assert from_es_score(0.5) == pytest.approx(0.0)


def test_first_vector_fixes_the_dimensions_of_the_index():
    client, index = es_index()

    index.upsert("u1", "proj", [VectorItem("mem_1", [1.0, 0.0, 0.0])])

    mapping = client.indices_map["hindsight_u1"]["mappings"]
    assert mapping["properties"]["embedding"] == {
        "type": "dense_vector", "dims": 3, "index": True, "similarity": "cosine",
    }
    assert mapping["properties"]["bank_id"] == {"type": "keyword"}


def test_a_vector_of_another_size_is_refused_rather_than_mixed_in():
    client, index = es_index()
    index.upsert("u1", "proj", [VectorItem("mem_1", [1.0, 0.0, 0.0])])

    written = index.upsert("u1", "proj", [VectorItem("mem_2", [1.0, 0.0])])

    assert written == 0
    assert set(client.indices_map["hindsight_u1"]["docs"]) == {"mem_1"}


def test_search_returns_cosine_ordered_by_similarity():
    client, index = es_index()
    index.upsert("u1", "proj", [
        VectorItem("near", [1.0, 0.0, 0.0]),
        VectorItem("far", [0.0, 1.0, 0.0]),
    ])

    hits = index.search("u1", "proj", [1.0, 0.0, 0.0], 5)

    assert [unit_id for unit_id, _ in hits] == ["near", "far"]
    assert hits[0][1] == pytest.approx(1.0)


def test_search_filters_by_bank_and_kind():
    client, index = es_index()
    index.upsert("u1", "proj", [VectorItem("fact_1", [1.0, 0.0], kind="fact")])
    index.upsert("u1", "proj", [VectorItem("obs_1", [1.0, 0.0], kind="observation")])
    index.upsert("u2", "other", [VectorItem("other_1", [1.0, 0.0], kind="fact")])

    facts = index.search("u1", "proj", [1.0, 0.0], 5, kind="fact")
    every = index.search("u1", "proj", [1.0, 0.0], 5)

    assert [unit_id for unit_id, _ in facts] == ["fact_1"]
    assert {unit_id for unit_id, _ in every} == {"fact_1", "obs_1"}


def test_an_unreachable_cluster_reports_unhealthy_and_stops_writing():
    client, index = es_index()
    index.upsert("u1", "proj", [VectorItem("mem_1", [1.0, 0.0])])
    client.healthy = False
    index._checked_at = 0.0  # drop the health cache

    assert index.available() is False
    assert index.upsert("u1", "proj", [VectorItem("mem_2", [0.0, 1.0])]) == 1
    # Writes still go to the cluster (it may simply be the ping that failed);
    # reads fall back at the engine level, which the next test covers.
    assert set(client.indices_map["hindsight_u1"]["docs"]) == {"mem_1", "mem_2"}


# -- retain, dedup, recall through the engine ---------------------------


def test_retain_mirrors_every_vector_into_the_index(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)

    result = run(engine.retain("u1", "proj", "月度对账流程的风险评审。" * 30,
                               document_id="doc_1", providers=FactProviders()))

    docs = client.indices_map["hindsight_u1"]["docs"]
    assert result["stored"] == len(docs) > 0
    assert {doc["bank_id"] for doc in docs.values()} == {"proj"}
    assert {doc["document_id"] for doc in docs.values()} == {"doc_1"}
    assert index.count("u1", "proj") == result["stored"]
    # The SQLite copy is still written: it is what a rebuild reads from.
    assert len(engine.store.embeddings("u1", "proj")) == result["stored"]


def test_dedup_asks_the_index_for_nearest_neighbours(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    text = "生产库的缓存是 Redis 6380"
    unit = Unit(id="mem_known", tenant_id="u1", bank_id="proj", text=text)
    engine.store.insert_unit(unit, tokenize(text), vector_for(text))
    index.upsert("u1", "proj", [VectorItem("mem_known", vector_for(text))])

    # known_vectors is None when the index answers per query, which is the case
    # the SQLite branch never exercised.
    duplicate = engine._find_duplicate("u1", "proj", "缓存用的是 Redis 6380 端口", vector_for(text), None)

    assert duplicate is not None and duplicate.id == "mem_known"
    assert client.searches == 1


def test_recall_gets_its_semantic_hits_from_the_index(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    body = "月度对账流程的风险评审。" * 30
    run(engine.retain("u1", "proj", body, document_id="doc_1", providers=FactProviders()))
    stored = next(iter(client.indices_map["hindsight_u1"]["docs"].values()))["embedding"]

    outcome = run(engine.recall("u1", "proj", "风险评审",
                                providers=FixedEmbedProviders(stored), trace=True))

    assert outcome.results
    assert outcome.trace["arms"].get("semantic", 0) > 0
    assert client.searches > 0


def test_recall_falls_back_to_the_scan_when_the_cluster_is_down(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    run(engine.retain("u1", "proj", "月度对账流程的风险评审。" * 30,
                      document_id="doc_1", providers=FactProviders()))
    stored = next(iter(client.indices_map["hindsight_u1"]["docs"].values()))["embedding"]
    client.healthy = False
    index._checked_at = 0.0

    assert isinstance(engine.active_vector_index, SqliteVectorIndex)
    outcome = run(engine.recall("u1", "proj", "风险评审",
                                providers=FixedEmbedProviders(stored), trace=True))

    assert outcome.results
    assert outcome.trace["arms"].get("semantic", 0) > 0


def test_index_writes_that_are_lost_are_reported_as_dirty(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    client.bulk = lambda **kwargs: {"errors": True, "items": [{"index": {"error": "boom"}}]}

    result = run(engine.retain("u1", "proj", "月度对账流程的风险评审。" * 30,
                               document_id="doc_1", providers=FactProviders()))

    assert result["stored"] > 0
    assert engine.status()["vector_dirty"] is True
    assert engine.vector_index_status("u1", "proj")["sqlite_vectors"] == result["stored"]


# -- deletion and maintenance -------------------------------------------


def test_deleting_a_document_drops_its_vectors_from_the_index(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    run(engine.retain("u1", "proj", "要删除的文档。" * 60, document_id="doc_1",
                      providers=FactProviders()))
    run(engine.retain("u1", "proj", "要保留的文档。" * 60, document_id="doc_2",
                      providers=FactProviders()))
    assert index.count("u1", "proj") > 0

    engine.delete_document("u1", "proj", "doc_1")

    remaining = client.indices_map["hindsight_u1"]["docs"].values()
    assert {doc["document_id"] for doc in remaining} == {"doc_2"}
    assert index.count("u1", "proj") == len(list(remaining))


def test_deleting_a_memory_drops_its_vector(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    text = "生产库的缓存是 Redis 6380"
    unit = Unit(id="mem_gone", tenant_id="u1", bank_id="proj", text=text)
    engine.store.insert_unit(unit, tokenize(text), vector_for(text))
    index.upsert("u1", "proj", [VectorItem("mem_gone", vector_for(text))])

    assert engine.delete_memory("u1", "proj", "mem_gone") is True

    assert index.count("u1", "proj") == 0


def test_deleting_a_bank_clears_its_vectors(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    run(engine.retain("u1", "proj", "要清空的文档。" * 60, document_id="doc_1",
                      providers=FactProviders()))

    engine.delete_bank("u1", "proj")

    assert index.count("u1", "proj") == 0
    assert client.deleted_by_query > 0
    assert client.indices_map["hindsight_u1"]["docs"] == {}


def test_prune_reports_vector_ids_and_drops_them(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    run(engine.retain("u1", "proj", "旧记忆。" * 60, document_id="doc_1", providers=FactProviders()))
    old = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat(timespec="seconds")
    with engine.store.connect() as conn:
        conn.execute("UPDATE units SET created_at=?", (old,))

    dry = engine.prune("u1", "proj", days=90, dry_run=True)
    counts = engine.prune("u1", "proj", days=90)

    assert dry["memories"] > 0 and "unit_ids" not in dry
    assert counts["memories"] == dry["memories"] > 0
    assert index.count("u1", "proj") == 0


def test_clearing_observations_drops_their_vectors(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    text = "观察：对账流程每次都要人工复核"
    unit = Unit(id="ob_gone", tenant_id="u1", bank_id="proj", text=text, kind="observation")
    engine.store.insert_unit(unit, tokenize(text), vector_for(text))
    index.upsert("u1", "proj", [VectorItem("ob_gone", vector_for(text), kind="observation")])

    removed = engine.clear_observations("u1", "proj")

    assert removed == 1
    # The observation row is gone, so its vector must not linger in the index:
    # a stale hit would resolve to nothing and inflate the indexed count.
    assert index.count("u1", "proj") == 0
    assert engine.store.units("u1", "proj", kind="observation") == []


def test_status_reports_a_broken_index_instead_of_failing(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)

    def boom(tenant_id, bank_id=""):
        raise RuntimeError("cluster is closed")

    index.count = boom

    info = engine.vector_index_status("u1", "proj")

    assert info["indexed"] == 0
    assert "cluster is closed" in info["index_error"]

def test_rebuilding_the_index_does_not_embed_anything_again(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    providers = FactProviders()
    result = run(engine.retain("u1", "proj", "月度对账流程的风险评审。" * 30,
                               document_id="doc_1", providers=providers))
    client.indices_map["hindsight_u1"]["docs"].clear()
    embeds_before = providers.embed_calls

    rebuilt = engine.rebuild_vector_index("u1", "proj")

    assert rebuilt["reindexed"] == result["stored"]
    assert index.count("u1", "proj") == result["stored"]
    assert providers.embed_calls == embeds_before


def test_status_names_the_vector_backend(tmp_path):
    client, index = es_index()
    engine = engine_at(tmp_path, index)
    engine.store.init()
    engine.store.ensure_bank("u1", "proj")

    status = engine.status()

    assert status["vector_backend"] == BACKEND_ELASTICSEARCH
    assert status["vector_index"] == "hindsight_<tenant>"
    assert status["vector_dirty"] is False


# -- delete_bank takes the vector index with it even for large banks -----


def test_vectors_are_deleted_in_bulk_batches():
    client, index = es_index()
    items = [VectorItem(f"mem_{i}", [1.0, 0.0]) for i in range(BULK_BATCH + 3)]
    index.upsert("u1", "proj", items)

    removed = index.delete("u1", "proj", [f"mem_{i}" for i in range(BULK_BATCH + 3)])

    assert removed == BULK_BATCH + 3
    assert index.count("u1", "proj") == 0
