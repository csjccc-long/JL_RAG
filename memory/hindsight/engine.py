"""The native memory engine: retain, recall, reflect, consolidate.

This is the port of Hindsight's server-side engine into RAGFlow's process. It
keeps the mechanisms that make that system work - fact extraction with resolved
references and absolute dates, four-arm recall fused by RRF, token-budget
packing, corroboration-aware re-ranking, background consolidation into
observations, bounded reflection - and drops the parts that only exist to serve
a multi-tenant HTTP deployment (workers, queues, admission control, webhooks).

One engine instance owns one SQLite file. Banks inside it separate projects,
users and surfaces; queries always carry the tenant and bank, so nothing leaks
between them.

Retain is the only expensive call (one extraction prompt per document), which
is why the hindsight mode is never inferred and must be switched on.
"""

from __future__ import annotations

import asyncio
import logging
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Sequence

from memory.hindsight import consolidate as consolidation
from memory.hindsight.chunking import CHUNK_CHARS, chunk_text
from memory.hindsight import webhooks as webhook_events
from memory.hindsight.extract import ExtractedFact, apply_defense, extract_facts
from memory.hindsight.fusion import cosine
from memory.hindsight.llm import NullProviders, Providers
from memory.hindsight.recall import RecallQuery, RecallOutcome, recall as run_recall
from memory.hindsight.reflect import reflect as run_reflect
from memory.hindsight.store import MemoryStore, Unit, new_id, utcnow
from memory.hindsight.tokens import search_terms, tokenize
from memory.hindsight.vector_index import (
    BACKEND_AUTO,
    DEFAULT_INDEX_PREFIX,
    BaseVectorIndex,
    SqliteVectorIndex,
    VectorItem,
    build_vector_index,
)
from memory.hindsight.scheduler import MemoryScheduler
from memory.hindsight.worker import RetainWorker

logger = logging.getLogger(__name__)

DEFAULT_BANK = "ragflow"
DEFAULT_DB = "hindsight.db"


_NOISE = re.compile(r"[\s\W_]+", re.UNICODE)

# Two facts this close in meaning are one fact said twice; the text heuristics
# below only catch the phrasing that is nearly identical character for character.
DEDUP_COSINE = 0.92

# How many nearest neighbours a new fact is checked against before it is stored.
# One would be enough to catch a restatement; the margin covers a bank where the
# closest neighbour is something else that merely shares the topic.
DEDUP_NEIGHBOURS = 5


def _normalise(text: str) -> str:
    """Case- and punctuation-insensitive form used to spot the same fact twice."""
    return _NOISE.sub("", (text or "").lower())


def _emit_nowait(store: MemoryStore, tenant_id: str, bank_id: str, event: str,
                 payload: dict[str, Any]) -> None:
    """Schedule a webhook from sync code; silently skip when no loop exists."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(webhook_events.emit(store, tenant_id, bank_id, event, payload))


class HindsightEngine:
    """Stateful facade over the store and the algorithms above."""

    def __init__(
        self,
        db_path: str | Path,
        *,
        default_bank: str = DEFAULT_BANK,
        budget: str = "mid",
        max_tokens: int = 1200,
        top_k: int = 5,
        defense: bool = False,
        consolidate_after: int = 12,
        chunk_chars: int = CHUNK_CHARS,
        vector_backend: str = BACKEND_AUTO,
        vector_index_prefix: str = DEFAULT_INDEX_PREFIX,
        vector_index: BaseVectorIndex | None = None,
    ):
        self.db_path = Path(db_path).expanduser()
        self.default_bank = default_bank or DEFAULT_BANK
        self.budget = budget
        self.max_tokens = max_tokens
        self.top_k = top_k
        self.defense = defense
        self.consolidate_after = consolidate_after
        # Retain chunks the body before extraction, the way Hindsight does: a long
        # document becomes several extraction calls and every fact remembers the
        # chunk it came from.
        self.chunk_chars = max(200, int(chunk_chars or CHUNK_CHARS))
        # Vectors live in a vector database when the deployment has one; the
        # SQLite rows stay the source of truth so the index can be rebuilt.
        self.vector_backend = vector_backend or BACKEND_AUTO
        self.vector_index_prefix = vector_index_prefix or DEFAULT_INDEX_PREFIX
        self._vector_index = vector_index
        self._vector_dirty = False
        self._store: MemoryStore | None = None
        self._worker: RetainWorker | None = None
        self._scheduler: MemoryScheduler | None = None
        self._providers_factory = None

    # -- plumbing ------------------------------------------------------

    @property
    def store(self) -> MemoryStore:
        if self._store is None:
            self._store = MemoryStore(self.db_path)
            self._store.init()
        return self._store

    @property
    def vector_index(self) -> BaseVectorIndex:
        """Where writes go: the configured index, built on first use."""
        if self._vector_index is None:
            self._vector_index = build_vector_index(
                self.store, backend=self.vector_backend, prefix=self.vector_index_prefix
            )
        return self._vector_index

    @property
    def active_vector_index(self) -> BaseVectorIndex:
        """Where reads go: the configured index while it answers, the scan otherwise.

        An unreachable vector database must cost the semantic arm precision, not
        the arm itself, so recall keeps working off the SQLite copy.
        """
        index = self.vector_index
        if isinstance(index, SqliteVectorIndex) or index.available():
            return index
        return SqliteVectorIndex(self.store)

    def vector_index_status(self, tenant_id: str = "", bank_id: str = "") -> dict[str, Any]:
        info = dict(self.vector_index.describe(tenant_id))
        info["dirty"] = self._vector_dirty
        if tenant_id:
            bank = bank_id or self.default_bank
            try:
                info["indexed"] = self.vector_index.count(tenant_id, bank)
            except Exception as exc:  # noqa: BLE001 - a status read never fails a page
                # An index that does not exist yet is the normal state before
                # the first retain; report it rather than failing the page.
                info["indexed"] = 0
                info["index_error"] = str(exc)
            try:
                info["sqlite_vectors"] = len(self.store.embeddings(tenant_id, bank))
            except Exception:  # noqa: BLE001 - a status read never fails a page
                info["sqlite_vectors"] = 0
        return info

    def rebuild_vector_index(self, tenant_id: str, bank_id: str = "", *,
                             batch: int = 200) -> dict[str, Any]:
        """Re-index a bank from the vectors SQLite already holds, without re-embedding."""
        bank = bank_id or self.default_bank
        index = self.vector_index
        if isinstance(index, SqliteVectorIndex):
            return {"backend": index.backend, "reindexed": 0,
                    "reason": "the sqlite vectors are the index"}
        vectors = self.store.embeddings(tenant_id, bank)
        if not vectors:
            return {"backend": index.backend, "reindexed": 0, "reason": "no vectors stored"}
        units = {unit.id: unit for unit in self.store.units(tenant_id, bank)}
        items = [
            VectorItem(
                unit_id=unit_id,
                vector=vector,
                kind=units[unit_id].kind if unit_id in units else "fact",
                document_id=units[unit_id].document_id if unit_id in units else "",
                tags=tuple(units[unit_id].tags or ()) if unit_id in units else (),
            )
            for unit_id, vector in vectors.items() if vector
        ]
        written = 0
        for start in range(0, len(items), max(1, batch)):
            written += index.upsert(tenant_id, bank, items[start:start + max(1, batch)])
        self._vector_dirty = written < len(items)
        self.store.audit(tenant_id, bank, "vector_index.rebuild",
                         {"indexed": written, "vectors": len(items)})
        return {"backend": index.backend, "reindexed": written, "vectors": len(items)}

    def _index_vectors(self, tenant_id: str, bank: str, items: Sequence[VectorItem]) -> int:
        """Mirror new vectors into the vector database; the SQLite copy is written already."""
        if not items:
            return 0
        index = self.vector_index
        if isinstance(index, SqliteVectorIndex):
            return len(items)
        try:
            written = index.upsert(tenant_id, bank, items)
        except Exception as exc:  # noqa: BLE001 - retain already succeeded
            logger.warning("hindsight retain: vector index write failed (%s)", exc)
            written = 0
        if written < len(items):
            self._vector_dirty = True
            logger.warning(
                "hindsight retain: %d of %d vectors are only in SQLite; vector index lags until rebuilt",
                len(items) - written, len(items),
            )
        return written

    def _forget_vectors(self, tenant_id: str, bank: str, unit_ids: Sequence[str]) -> int:
        if not unit_ids:
            return 0
        index = self.vector_index
        if isinstance(index, SqliteVectorIndex):
            return len(unit_ids)
        try:
            return index.delete(tenant_id, bank, unit_ids)
        except Exception as exc:  # noqa: BLE001 - the row is gone; a stale vector is dropped later
            logger.warning("hindsight: cannot drop vectors (%s)", exc)
            return 0

    def _forget_bank_vectors(self, tenant_id: str, bank: str) -> int:
        index = self.vector_index
        if isinstance(index, SqliteVectorIndex):
            return 0
        try:
            return index.delete_bank(tenant_id, bank)
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight: cannot clear the bank's vectors (%s)", exc)
            return 0

    def status(self) -> dict[str, Any]:
        healthy = True
        error = ""
        try:
            # Touching the file shows a broken path here; the recovery pass also
            # closes jobs a restart stranded, so the console never shows a queue
            # item stuck in running that nobody owns.
            self.store.recover_operations(limit=0)
        except Exception as exc:  # noqa: BLE001 - status must render regardless
            healthy, error = False, str(exc)
        status = {
            "backend": "native",
            "db_path": str(self.db_path),
            "bank": self.default_bank,
            "budget": self.budget,
            "max_tokens": self.max_tokens,
            "top_k": self.top_k,
            "defense": self.defense,
            "consolidate_after": self.consolidate_after,
            "chunk_chars": self.chunk_chars,
            "healthy": healthy,
        }
        try:
            status["vector_backend"] = self.vector_index.backend
            status["vector_index"] = self.vector_index.describe().get("index", "")
            status["vector_dirty"] = self._vector_dirty
        except Exception as exc:  # noqa: BLE001 - a broken index must not hide the rest
            status["vector_backend"] = self.vector_backend
            status["vector_error"] = str(exc)
        if error:
            status["error"] = error
        return status

    # -- retain --------------------------------------------------------

    async def retain(
        self,
        tenant_id: str,
        bank_id: str,
        content: str,
        *,
        document_id: str = "",
        tags: Sequence[str] = (),
        metadata: dict[str, Any] | None = None,
        providers: Providers | None = None,
        today=None,
        operation_id: str = "",
        chunk_chars: int | None = None,
    ) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        body = (content or "").strip()
        if not body:
            return {"stored": 0, "skipped": 0, "facts": [], "document_id": document_id}
        providers = providers or NullProviders()
        doc_id = document_id or new_id("doc_")
        if not operation_id:
            operation_id = self.store.create_operation(
                tenant_id, bank, "retain",
                {"content": body, "document_id": doc_id, "tags": list(tags),
                 "metadata": dict(metadata or {}),
                 "chunk_chars": int(chunk_chars or self.chunk_chars)},
            )
        self.store.ensure_bank(tenant_id, bank)
        fresh = self.store.upsert_document(tenant_id, bank, doc_id, body, tags=tags, metadata=metadata)
        if not fresh:
            self.store.finish_operation(operation_id, status="skipped", detail={"document_id": doc_id})
            return {"stored": 0, "skipped": 0, "facts": [], "document_id": doc_id,
                    "operation_id": operation_id, "duplicate": True}
        limit = max(200, int(chunk_chars or self.chunk_chars))
        chunks = chunk_text(body, limit, structured_chunk_size=limit)
        rows = self.store.replace_chunks(tenant_id, bank, doc_id, chunks)
        context = str((metadata or {}).get("context") or "")
        facts: list[tuple[ExtractedFact, str]] = []
        for row in rows:
            extracted = await extract_facts(providers, row["chunk_text"], context=context, today=today)
            for fact in apply_defense(extracted, self.defense):
                facts.append((fact, row["chunk_id"]))
        stored = 0
        deduped = 0
        aliases = self.store.alias_map(tenant_id, bank)
        created: list[tuple[ExtractedFact, Unit]] = []
        indexed: list[VectorItem] = []
        vectors: list[list[float]] = []
        # The write path reads through the index that is configured: a vector
        # database answers per fact, the SQLite fallback hands over the bank.
        vector_index = self.active_vector_index
        known_vectors = vector_index.lookup(tenant_id, bank)
        if facts:
            try:
                vectors = await providers.embed([fact.text for fact, _ in facts])
            except Exception as exc:  # noqa: BLE001 - BM25 still finds it without a vector
                logger.warning("hindsight retain: embedding unavailable (%s)", exc)
                vectors = []
        for index, (fact, chunk_id) in enumerate(facts):
            vector = vectors[index] if index < len(vectors) else None
            existing = self._find_duplicate(tenant_id, bank, fact.text, vector, known_vectors)
            if existing is not None:
                self.store.update_unit(existing.id, proof_count=existing.proof_count + 1)
                deduped += 1
                created.append((fact, existing))
                continue
            unit = Unit(
                id=new_id("mem_"),
                tenant_id=tenant_id,
                bank_id=bank,
                text=fact.text,
                kind="fact",
                fact_type=fact.fact_type,
                context=" | ".join(
                    part for part in (fact.context, str((metadata or {}).get("context") or "")) if part
                ),
                document_id=doc_id,
                chunk_id=chunk_id,
                tags=list(tags),
                occurred_start=fact.occurred_start,
                occurred_end=fact.occurred_end,
                mentioned_at=utcnow(),
                created_at=utcnow(),
            )
            vector = vectors[index] if index < len(vectors) else None
            self.store.insert_unit(unit, tokenize(unit.text), vector)
            if vector:
                indexed.append(VectorItem(unit.id, vector, document_id=doc_id, tags=tuple(tags)))
            names = [aliases.get(name.lower(), name) for name in fact.entities]
            self.store.add_entities(tenant_id, bank, unit.id, names)
            stored += 1
            created.append((fact, unit))
        self._link_batch(tenant_id, bank, created)
        if indexed:
            self._index_vectors(tenant_id, bank, indexed)
        if stored and self.consolidate_after and stored >= self.consolidate_after:
            try:
                await consolidation.consolidate(self.store, tenant_id, bank, providers, max_batches=1)
            except Exception as exc:  # noqa: BLE001 - retain already succeeded
                logger.warning("hindsight retain: consolidation skipped (%s)", exc)
        detail = {"stored": stored, "deduped": deduped, "document_id": doc_id, "chunks": len(rows)}
        self.store.finish_operation(operation_id, status="done", detail=detail)
        self.store.audit(tenant_id, bank, "retain", detail)
        await webhook_events.emit(self.store, tenant_id, bank, "retain",
                                  {"document_id": doc_id, "stored": stored, "deduped": deduped})
        return {
            "stored": stored,
            "deduped": deduped,
            "duplicate_facts": deduped,
            "facts": [fact.to_dict() for fact, _ in created],
            "document_id": doc_id,
            "chunks": len(rows),
            "operation_id": operation_id,
        }

    async def enqueue_retain(
        self,
        tenant_id: str,
        bank_id: str,
        content: str,
        *,
        document_id: str = "",
        tags: Sequence[str] = (),
        metadata: dict[str, Any] | None = None,
        providers_factory=None,
        chunk_chars: int | None = None,
    ) -> dict[str, Any]:
        """Queue a write instead of performing it in the request path."""
        bank = bank_id or self.default_bank
        body = (content or "").strip()
        if not body:
            return {"queued": False, "reason": "empty"}
        if providers_factory is not None:
            self._providers_factory = providers_factory
        doc_id = document_id or new_id("doc_")
        operation_id = self.store.create_operation(
            tenant_id, bank, "retain",
            {"content": body, "document_id": doc_id, "tags": list(tags),
             "metadata": dict(metadata or {}),
             "chunk_chars": int(chunk_chars or self.chunk_chars)},
            status="queued",
        )
        await self.start_scheduler()
        await self.retain_worker.submit_async(operation_id)
        return {"queued": True, "operation_id": operation_id, "document_id": doc_id}

    @property
    def retain_worker(self) -> RetainWorker:
        if self._worker is None:
            self._worker = RetainWorker(self.store, self._retain_from_operation)
        return self._worker

    async def _retain_from_operation(self, operation: dict[str, Any]) -> None:
        payload = operation.get("payload") or {}
        factory = self._providers_factory
        providers = factory(operation["tenant_id"]) if factory else NullProviders()
        await self.retain(
            operation["tenant_id"], operation["bank_id"], payload.get("content", ""),
            document_id=payload.get("document_id", ""),
            tags=payload.get("tags") or (),
            metadata=payload.get("metadata") or {},
            providers=providers,
            operation_id=operation["id"],
            chunk_chars=payload.get("chunk_chars") or self.chunk_chars,
        )

    async def start_scheduler(self, *, refresh_hours: int = 24,
                              consolidate_minutes: int = 60) -> None:
        if self._scheduler is None:
            self._scheduler = MemoryScheduler(self, refresh_hours=refresh_hours,
                                              consolidate_minutes=consolidate_minutes)
        await self._scheduler.start()

    def scheduler_status(self) -> dict[str, Any]:
        if self._scheduler is None:
            return {"started": False, "refresh_hours": 0, "consolidate_minutes": 0,
                    "last_run": "", "last_error": "", "refreshed": 0, "consolidated": 0}
        return self._scheduler.status()

    async def run_maintenance(self, *, force: bool = True) -> dict[str, Any]:
        await self.start_scheduler()
        return await self._scheduler.run_due(force=force)

    def worker_status(self, tenant_id: str = "", bank_id: str = "") -> dict[str, Any]:
        if self._worker is None:
            return {"started": False, "concurrency": 0, "queued": 0, "running": 0,
                    "done": 0, "failed": 0, "operations": {}}
        return self._worker.status(tenant_id, bank_id)

    def _find_duplicate(self, tenant_id: str, bank: str, text: str,
                        vector: Sequence[float] | None = None,
                        known_vectors: dict[str, Sequence[float]] | None = None) -> Unit | None:
        """Is this fact already known? Then it is corroboration, not news.

        An exact match is obvious, but a chat re-states the same fact in its own
        words every turn ("remembered: the cache is Redis 6380" today, "our cache
        runs Redis on 6380" tomorrow), and each restatement would otherwise add a
        row that later crowds the recall budget. Near-duplicates are therefore
        folded into the earlier fact and only raise its proof count.
        """
        probe = _normalise(text)
        if not probe:
            return None
        if vector:
            duplicate = self._vector_duplicate(tenant_id, bank, vector, known_vectors)
            if duplicate is not None:
                return duplicate
        for unit in self.store.units(tenant_id, bank, kind="fact", limit=400):
            known = _normalise(unit.text)
            if not known:
                continue
            if known == probe:
                return unit
            shorter, longer = sorted((known, probe), key=len)
            if len(shorter) >= 12 and shorter in longer:
                return unit
            if SequenceMatcher(None, known, probe).ratio() >= 0.85:
                return unit
        return None

    def _vector_duplicate(self, tenant_id: str, bank: str, vector: Sequence[float],
                          known_vectors: dict[str, Sequence[float]] | None) -> Unit | None:
        """The nearest neighbour a restatement would collide with, if it is one.

        The index is asked rather than loaded when it cannot hand over the bank
        cheaply, which is what makes dedup cheap on a large bank.
        """
        if known_vectors is not None:
            for unit in self.store.units(tenant_id, bank, kind="fact", limit=400):
                other = known_vectors.get(unit.id)
                if other and cosine(vector, other) >= DEDUP_COSINE:
                    return unit
            return None
        try:
            hits = self.active_vector_index.search(
                tenant_id, bank, vector, DEDUP_NEIGHBOURS, kind="fact"
            )
        except Exception as exc:  # noqa: BLE001 - a miss only costs a duplicate row
            logger.warning("hindsight retain: duplicate check skipped (%s)", exc)
            return None
        for unit_id, score in hits:
            if score < DEDUP_COSINE:
                continue
            unit = self.store.get_unit(unit_id)
            # The row is the authority: an index document can point at a unit
            # that was deleted, and banks share a tenant's index.
            if unit is not None and unit.tenant_id == tenant_id and unit.bank_id == bank:
                return unit
        return None

    def _link_batch(self, tenant_id: str, bank: str,
                    created: list[tuple[ExtractedFact, Unit]]) -> None:
        """Causal links from the extractor plus co-mention links between facts."""
        for fact, unit in created:
            for target_index in fact.caused_by:
                if 0 <= target_index < len(created):
                    target = created[target_index][1]
                    self.store.add_link(tenant_id, bank, target.id, unit.id, "caused_by")
        entity_owner: dict[str, str] = {}
        for _, unit in created:
            for name in self.store.unit_entities(tenant_id, bank).get(unit.id, []):
                other = entity_owner.get(name)
                if other and other != unit.id:
                    self.store.add_link(tenant_id, bank, other, unit.id, "co_mention", 0.5)
                entity_owner[name] = unit.id

    # -- recall --------------------------------------------------------

    async def recall(
        self,
        tenant_id: str,
        bank_id: str,
        query: str,
        *,
        providers: Providers | None = None,
        limit: int | None = None,
        max_tokens: int | None = None,
        types: Sequence[str] = (),
        tags: Sequence[str] = (),
        tags_match: str = "any",
        boost: str | None = None,
        prefer_observations: bool = False,
        temporal_window: dict[str, Any] | None = None,
        query_timestamp: str | None = None,
        trace: bool = False,
    ) -> RecallOutcome:
        bank = bank_id or self.default_bank
        if not (query or "").strip():
            return RecallOutcome(results=[], trace={})
        request = RecallQuery(
            query=query,
            types=types,
            tags=tags,
            tags_match=tags_match,
            temporal_window=temporal_window,
            query_timestamp=query_timestamp,
            budget=self.budget,
            max_tokens=max_tokens if max_tokens is not None else self.max_tokens,
            limit=limit if limit is not None else self.top_k,
            boost=boost,
            prefer_observations=prefer_observations,
            trace=trace,
        )
        try:
            return await run_recall(
                self.store, tenant_id, bank, request,
                providers=providers, vector_index=self.active_vector_index,
            )
        except Exception as exc:  # noqa: BLE001 - memory is decoration, never fatal
            logger.warning("hindsight recall failed (%s); continuing without memories", exc)
            return RecallOutcome(results=[], trace={"error": str(exc)} if trace else {})

    # -- reflect -------------------------------------------------------

    async def reflect(
        self,
        tenant_id: str,
        bank_id: str,
        query: str,
        *,
        providers: Providers | None = None,
        limit: int = 6,
        max_tokens: int | None = None,
        max_steps: int = 6,
        tags: Sequence[str] = (),
    ) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        providers = providers or NullProviders()
        directives = [item["content"] for item in self.store.directives(tenant_id, bank)]
        models = [item["content"] for item in self.store.mental_models(tenant_id, bank) if item.get("content")]
        result = await run_reflect(
            self.store, tenant_id, bank, providers,
            query=query,
            limit=limit,
            max_tokens=max_tokens or self.max_tokens,
            max_steps=max_steps,
            directives=directives,
            mental_models=models,
            tags=tags,
        )
        self.store.audit(tenant_id, bank, "reflect", {"query": query, "steps": result.get("steps")})
        return result

    # -- consolidation -------------------------------------------------

    async def consolidate(self, tenant_id: str, bank_id: str, *,
                          providers: Providers | None = None, dry_run: bool = False,
                          tags: Sequence[str] = ()) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        result = await consolidation.consolidate(
            self.store, tenant_id, bank, providers or NullProviders(),
            scope_tags=tags, dry_run=dry_run,
        )
        if not dry_run:
            self.store.audit(tenant_id, bank, "consolidate", {
                "created": result.get("created", 0),
                "updated": result.get("updated", 0),
                "deleted": result.get("deleted", 0),
            })
            await webhook_events.emit(self.store, tenant_id, bank, "consolidate", result)
        return result

    def observations(self, tenant_id: str, bank_id: str) -> dict[str, Any]:
        return consolidation.observation_tree(self.store, tenant_id, bank_id or self.default_bank)

    def observation_scopes(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        return consolidation.observation_scopes(self.store, tenant_id, bank_id or self.default_bank)

    def clear_observations(self, tenant_id: str, bank_id: str, *, scope: str = "") -> int:
        bank = bank_id or self.default_bank
        return consolidation.clear_observations(
            self.store, tenant_id, bank, scope=scope,
            forget=lambda ids: self._forget_vectors(tenant_id, bank, ids),
        )

    # -- mental models -------------------------------------------------

    async def create_mental_model(self, tenant_id: str, bank_id: str, *, name: str,
                                  source_query: str, max_tokens: int = 600,
                                  providers: Providers | None = None) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        model_id = new_id("mm_")
        content = await self._summarise(tenant_id, bank, source_query, max_tokens, providers)
        return self.store.upsert_mental_model(
            tenant_id, bank, model_id, name=name or source_query[:60],
            source_query=source_query, content=content, max_tokens=max_tokens,
        )

    async def refresh_mental_model(self, tenant_id: str, bank_id: str, model_id: str,
                                   providers: Providers | None = None) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        model = self.store.get_mental_model(tenant_id, bank, model_id)
        if model is None:
            return {}
        content = await self._summarise(
            tenant_id, bank, model["source_query"], int(model.get("max_tokens") or 600), providers
        )
        self.store.audit(tenant_id, bank, "mental_model.refresh", {"id": model_id})
        await webhook_events.emit(self.store, tenant_id, bank, "mental_model.refresh",
                                  {"id": model_id})
        return self.store.upsert_mental_model(
            tenant_id, bank, model_id, name=model["name"], source_query=model["source_query"],
            content=content, max_tokens=int(model.get("max_tokens") or 600),
        )

    async def _summarise(self, tenant_id: str, bank: str, source_query: str,
                         max_tokens: int, providers: Providers | None) -> str:
        outcome = await self.recall(tenant_id, bank, source_query, providers=providers,
                                    limit=12, max_tokens=max_tokens)
        evidence = "\n".join(f"- {item['text']}" for item in outcome.results)
        if not evidence:
            return ""
        if providers is None:
            return evidence
        try:
            return (await providers.chat(
                "Summarise the memories below into a compact profile. Keep facts, "
                "drop repetition, do not invent. Plain text, no bullets larger than one line.",
                evidence, max_tokens=max_tokens, )).strip() or evidence
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight mental model: summarise failed (%s)", exc)
            return evidence

    def mental_models(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        return self.store.mental_models(tenant_id, bank_id or self.default_bank)

    def delete_mental_model(self, tenant_id: str, bank_id: str, model_id: str) -> None:
        self.store.delete_mental_model(tenant_id, bank_id or self.default_bank, model_id)

    # -- pages ---------------------------------------------------------

    def create_page(self, tenant_id: str, bank_id: str, *, title: str, content: str,
                    parent_id: str = "", tags: Sequence[str] = ()) -> dict[str, Any]:
        return self.store.add_page(tenant_id, bank_id or self.default_bank, title, content,
                                   parent_id=parent_id, tags=tags)

    def pages(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        return self.store.pages(tenant_id, bank_id or self.default_bank)

    def search_pages(self, tenant_id: str, bank_id: str, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        terms = [term.lower() for term in search_terms(query)]
        if not terms:
            return []
        scored = []
        for page in self.pages(tenant_id, bank_id):
            haystack = f"{page.get('title', '')} {page.get('content', '')}".lower()
            hits = sum(1 for term in terms if term in haystack)
            if hits:
                scored.append((hits, page))
        scored.sort(key=lambda item: -item[0])
        return [page for _, page in scored[:limit]]

    def delete_page(self, tenant_id: str, bank_id: str, page_id: str) -> None:
        self.store.delete_page(tenant_id, bank_id or self.default_bank, page_id)

    def export_pages(self, tenant_id: str, bank_id: str) -> str:
        chunks = ["# Memory pages\n"]
        for page in self.pages(tenant_id, bank_id):
            chunks.append(f"## {page['title']}\n\n{page['content']}\n")
        return "\n".join(chunks)

    # -- directives ----------------------------------------------------

    def add_directive(self, tenant_id: str, bank_id: str, content: str, *,
                      priority: int = 1, tags: Sequence[str] = ()) -> dict[str, Any]:
        return self.store.add_directive(tenant_id, bank_id or self.default_bank, content,
                                        priority=priority, tags=tags)

    def directives(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        return self.store.directives(tenant_id, bank_id or self.default_bank)

    def delete_directive(self, tenant_id: str, bank_id: str, directive_id: str) -> None:
        self.store.delete_directive(tenant_id, bank_id or self.default_bank, directive_id)

    # -- inspection ----------------------------------------------------

    def memories(self, tenant_id: str, bank_id: str, *, kind: str | None = None,
                 limit: int = 50, limit_to: int = 50) -> list[dict[str, Any]]:
        units = self.store.units(tenant_id, bank_id or self.default_bank, kind=kind, limit=limit)
        entity_map = self.store.unit_entities(tenant_id, bank_id or self.default_bank)
        out = []
        for unit in units:
            payload = unit.to_dict()
            payload["entities"] = entity_map.get(unit.id, [])
            out.append(payload)
        return out[:limit_to]

    def get_memory(self, tenant_id: str, bank_id: str, memory_id: str) -> Unit | None:
        unit = self.store.get_unit(memory_id)
        if unit is None or unit.tenant_id != tenant_id or unit.bank_id != (bank_id or self.default_bank):
            return None
        return unit

    def delete_memory(self, tenant_id: str, bank_id: str, memory_id: str) -> bool:
        unit = self.get_memory(tenant_id, bank_id, memory_id)
        if unit is None:
            return False
        self.store.delete_unit(memory_id)
        self._forget_vectors(tenant_id, unit.bank_id, [memory_id])
        self.store.audit(tenant_id, unit.bank_id, "memory.delete", {"id": memory_id})
        _emit_nowait(self.store, tenant_id, unit.bank_id, "memory.delete", {"id": memory_id})
        return True

    def memory_history(self, tenant_id: str, bank_id: str, memory_id: str) -> list[dict[str, Any]]:
        return [entry for entry in self.store.audit_logs(tenant_id, bank_id or self.default_bank, limit=200)
                if entry["detail"].get("id") == memory_id]

    def stats(self, tenant_id: str, bank_id: str) -> dict[str, Any]:
        return self.store.stats(tenant_id, bank_id or self.default_bank)

    def tags(self, tenant_id: str, bank_id: str) -> list[str]:
        return self.store.tags(tenant_id, bank_id or self.default_bank)

    def documents(self, tenant_id: str, bank_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        return self.store.list_documents(tenant_id, bank_id or self.default_bank, limit=limit)

    def get_document(self, tenant_id: str, bank_id: str, document_id: str) -> dict[str, Any] | None:
        return self.store.get_document(tenant_id, bank_id or self.default_bank, document_id)

    def delete_document(self, tenant_id: str, bank_id: str, document_id: str) -> int:
        """Remove a document, its chunks, and every fact extracted from them."""
        bank = bank_id or self.default_bank
        # Read the ids first: the rows (and the only record of which vectors
        # belonged to this document) are deleted by the call below.
        unit_ids = [unit.id for unit in self.store.units(tenant_id, bank, document_id=document_id)]
        removed = self.store.delete_document(tenant_id, bank, document_id)
        self._forget_vectors(tenant_id, bank, unit_ids)
        self.store.audit(tenant_id, bank, "document.delete",
                         {"document_id": document_id, "removed": removed, "vectors": len(unit_ids)})
        return removed

    def operations(self, tenant_id: str, bank_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        return self.store.operations(tenant_id, bank_id or self.default_bank, limit=limit)

    def audit_logs(self, tenant_id: str, bank_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        return self.store.audit_logs(tenant_id, bank_id or self.default_bank, limit=limit)

    def banks(self, tenant_id: str) -> list[dict[str, Any]]:
        return self.store.list_banks(tenant_id)

    def create_bank(self, tenant_id: str, bank_id: str, *, name: str = "") -> None:
        self.store.ensure_bank(tenant_id, bank_id, name=name)

    def delete_bank(self, tenant_id: str, bank_id: str) -> None:
        self._forget_bank_vectors(tenant_id, bank_id)
        self.store.delete_bank(tenant_id, bank_id)

    def prune(self, tenant_id: str, bank_id: str, *, days: int = 90,
              dry_run: bool = False) -> dict[str, Any]:
        """Drop memories older than a cutoff, here and in the vector index."""
        bank = bank_id or self.default_bank
        counts = self.store.prune(tenant_id, bank, days=days, dry_run=dry_run,
                                 collect_ids=not dry_run)
        unit_ids = counts.pop("unit_ids", []) if not dry_run else []
        if unit_ids:
            self._forget_vectors(tenant_id, bank, unit_ids)
            self.store.audit(tenant_id, bank, "prune", {"days": days, **counts})
        return counts

    def export_bank(self, tenant_id: str, bank_id: str) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        meta = self.store.get_bank(tenant_id, bank) or {}
        return {
            "bank": bank,
            "name": meta.get("name") or bank,
            "mission": meta.get("mission") or "",
            "config": meta.get("config") or {},
            "memories": self.memories(tenant_id, bank, limit=10000),
            "pages": self.pages(tenant_id, bank),
            "directives": self.directives(tenant_id, bank),
            "mental_models": self.mental_models(tenant_id, bank),
        }

    def import_bank(self, tenant_id: str, bank_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        bank = bank_id or self.default_bank
        self.store.ensure_bank(tenant_id, bank, name=str(payload.get("name") or bank))
        self.store.patch_bank(
            tenant_id, bank,
            mission=str(payload["mission"]) if payload.get("mission") else None,
            config=payload.get("config") if isinstance(payload.get("config"), dict) else None,
        )
        imported = 0
        for item in payload.get("memories") or []:
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            source_ids = list(item.get("source_fact_ids") or [])
            kind = str(item.get("kind") or ("observation" if source_ids else "fact"))
            fact_type = str(item.get("fact_type") or item.get("type") or "world")
            if fact_type not in {"world", "assistant", "experience"}:
                fact_type = "world"
            unit = Unit(
                id=new_id("mem_"), tenant_id=tenant_id, bank_id=bank, text=text,
                kind=kind, fact_type=fact_type,
                tags=list(item.get("tags") or []),
                source_fact_ids=source_ids,
                proof_count=int(item.get("proof_count") or 1),
                occurred_start=item.get("occurred_start"),
                occurred_end=item.get("occurred_end"),
                mentioned_at=item.get("mentioned_at") or utcnow(),
                created_at=utcnow(),
            )
            self.store.insert_unit(unit, tokenize(text), None)
            imported += 1
        for page in payload.get("pages") or []:
            self.store.add_page(
                tenant_id, bank, str(page.get("title") or ""), str(page.get("content") or ""),
                parent_id=str(page.get("parent_id") or ""), tags=page.get("tags") or (),
            )
        for directive in payload.get("directives") or []:
            self.store.add_directive(
                tenant_id, bank, str(directive.get("content") or ""),
                priority=int(directive.get("priority") or 1), tags=directive.get("tags") or (),
            )
        for model in payload.get("mental_models") or []:
            self.store.upsert_mental_model(
                tenant_id, bank, new_id("mm_"),
                name=str(model.get("name") or ""), source_query=str(model.get("source_query") or ""),
                content=str(model.get("content") or ""), max_tokens=int(model.get("max_tokens") or 600),
            )
        return {"imported": imported}


_ENGINE: HindsightEngine | None = None


def get_hindsight_engine(settings: Any = None) -> HindsightEngine:
    """Return the process-wide engine, building it from memory config once."""
    global _ENGINE
    if _ENGINE is not None and settings is None:
        return _ENGINE
    from_config = settings is None
    if from_config:
        from memory.config import MemorySettings

        settings = MemorySettings.load().hindsight
    engine = HindsightEngine(
        getattr(settings, "db_path", "") or _default_db_path(),
        default_bank=getattr(settings, "bank", DEFAULT_BANK),
        budget=getattr(settings, "budget", "mid"),
        max_tokens=getattr(settings, "max_tokens", 1200),
        top_k=getattr(settings, "top_k", 5),
        defense=getattr(settings, "defense", False),
        consolidate_after=getattr(settings, "consolidate_after", 12),
        chunk_chars=getattr(settings, "chunk_chars", CHUNK_CHARS),
        vector_backend=getattr(settings, "vector_backend", BACKEND_AUTO),
        vector_index_prefix=getattr(settings, "vector_index_prefix", DEFAULT_INDEX_PREFIX),
    )
    if from_config:
        _ENGINE = engine
    return engine


def reset_hindsight_engine() -> None:
    global _ENGINE
    _ENGINE = None


def _default_db_path() -> str:
    return str(Path.home() / ".ragflow" / "memory" / DEFAULT_DB)
