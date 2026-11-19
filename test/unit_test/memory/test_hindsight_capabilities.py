import asyncio
import hmac
import hashlib
import json
import zlib

from memory.hindsight.chunking import CHUNK_CHARS, chunk_text
from memory.hindsight.engine import HindsightEngine
from memory.hindsight.ingest import IngestError, extract_text
from memory.hindsight.recall import RecallQuery, recall
from memory.hindsight.rerank import apply_rerank, cross_scores, lexical_scores
from memory.hindsight.store import MemoryStore, Unit
from memory.hindsight.webhooks import signature
from memory.hindsight.worker import RetainWorker


def run(coro):
    return asyncio.run(coro)


def store_at(tmp_path):
    store = MemoryStore(str(tmp_path / "hindsight.db"))
    store.init()
    store.ensure_bank("u1", "proj")
    return store


class StubProviders:
    def __init__(self, scores=None):
        self.scores = scores

    async def rerank(self, query, docs):
        return self.scores


# -- ingest ------------------------------------------------------------


def test_chunk_text_splits_within_the_budget_and_loses_nothing():
    body = "第一句话。" * 400
    chunks = chunk_text(body, max_chars=100)
    assert len(chunks) == 20
    assert all(len(chunk) <= 100 for chunk in chunks)
    # No overlap: the chunks concatenate back into the original body.
    assert "".join(chunks) == body


def test_chunk_text_is_idempotent():
    body = ("段落一。" * 60) + "\n\n" + ("段落二。" * 60)
    chunks = chunk_text(body, max_chars=120)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk_text(chunk, max_chars=120) == [chunk]


def test_chunk_text_keeps_paragraph_breaks_as_boundaries():
    paragraphs = [f"第{index}段。" + "内容。" * 30 for index in range(6)]
    body = "\n\n".join(paragraphs)
    chunks = chunk_text(body, max_chars=200)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk in body
        assert len(chunk) <= 200
    rebuilt = "\n\n".join(chunks)
    assert rebuilt.replace("\n\n", "") == body.replace("\n\n", "")


def test_chunk_text_packs_conversation_turns_whole():
    turns = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"第{index}轮。" * 20}
        for index in range(6)
    ]
    body = json.dumps(turns, ensure_ascii=False)
    chunks = chunk_text(body, max_chars=400)
    assert len(chunks) > 1
    rebuilt = []
    for chunk in chunks:
        assert len(chunk) <= 400
        parsed = json.loads(chunk)
        assert isinstance(parsed, list)
        rebuilt.extend(parsed)
    assert rebuilt == turns


def test_chunk_text_splits_jsonl_at_line_boundaries():
    lines = [json.dumps({"id": index, "text": f"记录{index}"}, ensure_ascii=False) for index in range(30)]
    body = "\n".join(lines)
    chunks = chunk_text(body, max_chars=300)
    assert len(chunks) > 1
    rebuilt = []
    for chunk in chunks:
        assert len(chunk) <= 300
        rebuilt.extend(chunk.split("\n"))
    assert rebuilt == lines


def test_chunk_text_matches_recursive_character_splitter():
    body = "Alpha beta gamma. Delta epsilon! Zeta eta theta? Iota kappa; lambda, mu.\n\n" * 40
    for max_chars in (60, 120, 500):
        assert chunk_text(body, max_chars=max_chars) == _reference_recursive_split(body, max_chars)


def _reference_recursive_split(text: str, max_chars: int) -> list[str]:
    """langchain RecursiveCharacterTextSplitter, chunk_overlap=0, keep_separator=True."""
    separators = ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""]

    def split(body: str, seps: list[str]) -> list[str]:
        separator = seps[-1]
        for candidate in seps:
            if candidate == "" or candidate in body:
                separator = candidate
                break
        # keep_separator="start": the separator opens the following piece.
        parts: list[str] = []
        if separator == "":
            parts = list(body)
        else:
            pieces = body.split(separator)
            parts = [pieces[0]] + [separator + piece for piece in pieces[1:]]
        parts = [part for part in parts if part]
        final: list[str] = []
        pending: list[str] = []
        pending_len = 0

        def flush() -> None:
            nonlocal pending, pending_len
            piece = "".join(pending).strip()
            if piece:
                final.append(piece)
            pending, pending_len = [], 0

        for part in parts:
            if pending_len + len(part) > max_chars:
                flush()
            if len(part) > max_chars:
                final.extend(split(part, seps[seps.index(separator) + 1:]))
                continue
            pending.append(part)
            pending_len += len(part)
        flush()
        return final

    if len(text) <= max_chars:
        return [text]
    return split(text, separators)


def test_blank_text_produces_no_chunks():
    assert chunk_text("") == []
    assert chunk_text("\x00\x01") == []


# -- retain chunking ---------------------------------------------------


class FactProviders:
    """A model that answers every chunk with one fact quoting that chunk."""

    def __init__(self):
        self.embedded: list[str] = []

    async def chat(self, system, user, **kwargs):
        body = user.split("Conversation:", 1)[-1].strip()
        return json.dumps({"facts": [{"what": f"事实：{body[:40]}", "entities": ["系统"]}]}, ensure_ascii=False)

    async def embed(self, texts):
        # Distinct texts land in distinct one-hot slots, so the engine's cosine
        # dedupe does not merge facts that merely shared the old fixed vector.
        self.embedded = list(texts)
        vectors = []
        for text in texts:
            vector = [0.0] * 64
            vector[zlib.crc32(text.encode("utf-8")) % 64] = 1.0
            vectors.append(vector)
        return vectors


def engine_at(tmp_path, chunk_chars=200):
    engine = HindsightEngine(
        str(tmp_path / "engine.db"), default_bank="proj", consolidate_after=0, chunk_chars=chunk_chars
    )
    engine.store.init()
    engine.store.ensure_bank("u1", "proj")
    return engine


def test_retain_stores_chunks_and_links_every_fact_to_its_chunk(tmp_path):
    engine = engine_at(tmp_path)
    body = ("月度对账流程的风险评审。" * 40) + "\n\n" + ("合规检查清单。" * 40)
    result = run(engine.retain("u1", "proj", body, document_id="doc_1", providers=FactProviders()))

    rows = engine.store.list_chunks("u1", "proj", "doc_1")
    assert len(rows) == result["chunks"] > 1
    assert [row["chunk_index"] for row in rows] == list(range(len(rows)))
    # Chunks are stripped, so only the whitespace may differ from the source body.
    assert "".join("".join(row["chunk_text"].split()) for row in rows) == "".join(body.split())
    units = engine.store.units("u1", "proj", limit=100)
    assert units
    chunk_ids = {row["chunk_id"] for row in rows}
    assert all(unit.chunk_id in chunk_ids for unit in units)
    assert result["stored"] == len(units)


def test_reingest_replaces_chunks_and_drops_facts_from_the_old_body(tmp_path):
    engine = engine_at(tmp_path)
    providers = FactProviders()
    first = run(engine.retain("u1", "proj", "旧内容。" * 100, document_id="doc_1", providers=providers))
    old_chunks = engine.store.list_chunks("u1", "proj", "doc_1")
    old_units = engine.store.units("u1", "proj", limit=100)
    assert first["stored"] == len(old_units)

    second = run(engine.retain("u1", "proj", "新内容。" * 100, document_id="doc_1", providers=providers))
    new_chunks = engine.store.list_chunks("u1", "proj", "doc_1")
    assert {row["chunk_id"] for row in new_chunks}.isdisjoint({row["chunk_id"] for row in old_chunks})
    assert second["stored"] > 0
    surviving = {unit.chunk_id for unit in engine.store.units("u1", "proj", limit=100)}
    assert surviving <= {row["chunk_id"] for row in new_chunks}
    assert surviving.isdisjoint({row["chunk_id"] for row in old_chunks})


def test_reingesting_identical_content_keeps_chunk_ids(tmp_path):
    engine = engine_at(tmp_path)
    body = "同样的内容。" * 100
    run(engine.retain("u1", "proj", body, document_id="doc_1", providers=FactProviders()))
    before = [(row["chunk_index"], row["chunk_id"]) for row in engine.store.list_chunks("u1", "proj", "doc_1")]
    engine.store.replace_chunks("u1", "proj", "doc_1", chunk_text(body, max_chars=200))
    after = [(row["chunk_index"], row["chunk_id"]) for row in engine.store.list_chunks("u1", "proj", "doc_1")]
    assert before == after


def test_deleting_a_document_removes_its_chunks_and_its_facts(tmp_path):
    engine = engine_at(tmp_path)
    run(engine.retain("u1", "proj", "要删除的文档。" * 100, document_id="doc_1", providers=FactProviders()))
    run(engine.retain("u1", "proj", "要保留的文档。" * 100, document_id="doc_2", providers=FactProviders()))
    assert engine.store.list_chunks("u1", "proj", "doc_1")

    removed = engine.delete_document("u1", "proj", "doc_1")

    assert removed > 0
    assert engine.store.list_chunks("u1", "proj", "doc_1") == []
    assert engine.get_document("u1", "proj", "doc_1") is None
    assert {unit.document_id for unit in engine.store.units("u1", "proj", limit=100)} == {"doc_2"}
    assert engine.store.list_chunks("u1", "proj", "doc_2")


def test_document_listing_reports_how_many_chunks_each_document_has(tmp_path):
    engine = engine_at(tmp_path)
    run(engine.retain("u1", "proj", "第一份文档。" * 100, document_id="doc_1", providers=FactProviders()))
    run(engine.retain("u1", "proj", "短文档。", document_id="doc_2", providers=FactProviders()))
    listed = {row["document_id"]: row for row in engine.documents("u1", "proj")}
    assert listed["doc_1"]["chunk_count"] == len(engine.store.list_chunks("u1", "proj", "doc_1"))
    assert listed["doc_1"]["chunk_count"] > 1
    assert listed["doc_2"]["chunk_count"] == 1


def test_plain_text_is_decoded_and_unsupported_types_are_refused():
    assert run(extract_text("记忆模块设计".encode("utf-8"), "notes.txt")) == "记忆模块设计"
    try:
        run(extract_text(b"\x00\x01", "payload.exe"))
    except IngestError as exc:
        assert "unsupported file type" in str(exc)
    else:
        raise AssertionError("an unknown extension must be refused")


# -- rerank ------------------------------------------------------------


def test_lexical_scores_rank_the_matching_document_first():
    scores = lexical_scores(
        "pgvector 向量",
        ["团队决定用 pgvector 存向量", "今天午饭吃面"],
    )
    assert scores[0] > scores[1]


def test_a_model_reranker_can_overturn_the_fused_order():
    async def scenario():
        return await cross_scores(StubProviders([0.9, 0.1]), "q", ["a", "b"])

    assert run(scenario()) == [0.9, 0.1]
    entries = [("a", 1.0, {"rrf": 1.0}), ("b", 0.9, {"rrf": 0.9})]
    adjusted = apply_rerank(entries, [0.1, 0.9])
    assert adjusted[0][0] == "b"
    assert adjusted[0][2]["rerank"] == 0.9


# -- aliases and the graph arm ----------------------------------------


def test_alias_expands_the_entity_named_in_a_query(tmp_path):
    store = store_at(tmp_path)
    store.insert_unit(Unit(id="f1", tenant_id="u1", bank_id="proj",
                          text="Alexander 负责支付模块"), "", None)
    store.insert_unit(Unit(id="f2", tenant_id="u1", bank_id="proj",
                          text="支付模块使用 pgvector"), "", None)
    store.add_entities("u1", "proj", "f1", ["Alexander"])
    store.add_entities("u1", "proj", "f2", ["pgvector"])
    store.add_link("u1", "proj", "f1", "f2", "related", 1.0)
    store.add_alias("u1", "proj", "Alex", "Alexander")

    assert store.alias_map("u1", "proj") == {"alex": "Alexander"}
    outcome = run(recall(store, "u1", "proj",
                         RecallQuery(query="Alex 支付", trace=True, rerank=False)))
    assert outcome.results
    assert outcome.trace["arms"].get("graph", 0) > 0
    assert {item["id"] for item in outcome.results} & {"f1", "f2"}


# -- webhooks ----------------------------------------------------------


def test_webhook_signature_is_hmac_sha256_of_the_raw_body():
    body = b'{"event":"retain"}'
    expected = hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert signature("secret", body) == expected
    assert signature("other", body) != expected


# -- worker ------------------------------------------------------------


def test_worker_marks_a_job_done(tmp_path):
    store = store_at(tmp_path)
    operation_id = store.create_operation("u1", "proj", "retain", {"content": "x"})

    async def runner(operation):
        # The engine's own runner closes the operation; a bare worker just runs it.
        store.finish_operation(operation["id"], status="done", detail={"ok": True})

    async def scenario():
        worker = RetainWorker(store, runner)
        await worker.submit_async(operation_id)
        for _ in range(60):
            await asyncio.sleep(0.05)
            if store.get_operation(operation_id)["status"] == "done":
                break
        await worker.stop()

    run(scenario())
    operation = store.get_operation(operation_id)
    assert operation["status"] == "done"
    assert operation["attempts"] == 1


def test_worker_recovers_a_job_stranded_by_a_restart(tmp_path):
    store = store_at(tmp_path)
    operation_id = store.create_operation("u1", "proj", "retain", {"content": "x"})
    store.finish_operation(operation_id, status="running", attempts=1)

    async def runner(operation):
        store.finish_operation(operation["id"], status="done", detail={"ok": True})

    async def scenario():
        worker = RetainWorker(store, runner)
        worker.start()  # start alone must pick the stranded row back up
        for _ in range(60):
            await asyncio.sleep(0.05)
            if store.get_operation(operation_id)["status"] == "done":
                break
        await worker.stop()

    run(scenario())
    assert store.get_operation(operation_id)["status"] == "done"


def test_worker_records_the_last_error_when_retries_are_exhausted(tmp_path):
    store = store_at(tmp_path)
    operation_id = store.create_operation("u1", "proj", "retain", {"content": "x"})

    async def failing(operation):
        raise RuntimeError("model unavailable")

    async def scenario():
        worker = RetainWorker(store, failing, retries=0)
        await worker.submit_async(operation_id)
        for _ in range(60):
            await asyncio.sleep(0.05)
            if store.get_operation(operation_id)["status"] == "failed":
                break
        await worker.stop()

    run(scenario())
    operation = store.get_operation(operation_id)
    assert operation["status"] == "failed"
    assert "model unavailable" in operation["error"]
