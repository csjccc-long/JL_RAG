"""Vector storage for the native memory: Elasticsearch kNN, SQLite fallback.

The bank itself is relational - units, chunks, links, audit - and lives in one
SQLite file per deployment. Vectors used to live there too and were compared
with a brute-force cosine inside the API process, which is O(N) on every recall
and is not how upstream Hindsight works: it dispatches approximate
nearest-neighbour search to a vector database (PostgreSQL + pgvector by
default). RAGFlow already operates Elasticsearch as its document store, so the
same vectors are mirrored into a per-tenant index with a 'dense_vector' field
and searched with kNN.

SQLite keeps its copy of every vector. That copy is the fallback: a deployment
that runs Infinity instead of Elasticsearch, or one whose index has fallen
behind, still recalls through the scan rather than losing the semantic arm - and
the index can be rebuilt from it without re-embedding anything.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Sequence

from memory.hindsight.fusion import cosine

logger = logging.getLogger(__name__)

BACKEND_AUTO = "auto"
BACKEND_ELASTICSEARCH = "elasticsearch"
BACKEND_SQLITE = "sqlite"
VECTOR_BACKENDS = (BACKEND_AUTO, BACKEND_ELASTICSEARCH, BACKEND_SQLITE)

DEFAULT_INDEX_PREFIX = "hindsight"
EMBEDDING_FIELD = "embedding"
BULK_BATCH = 500

# Retain runs in the request path for synchronous callers and just ahead of the
# next recall for queued ones: wait for the refresh so a fact remembered now is
# findable immediately, which is what the SQLite path gave for free.
REFRESH_POLICY = "wait_for"

_INDEX_UNSAFE = re.compile(r"[^a-z0-9_]+")


def normalize_backend(value: Any) -> str:
    """Accept a configured backend name, falling back to 'auto'."""
    name = str(value or BACKEND_AUTO).strip().lower()
    return name if name in VECTOR_BACKENDS else BACKEND_AUTO


@dataclass(frozen=True)
class VectorItem:
    """One unit's vector, carried from retain to whichever index stores it."""

    unit_id: str
    vector: Sequence[float]
    kind: str = "fact"
    document_id: str = ""
    tags: tuple[str, ...] = field(default_factory=tuple)


class BaseVectorIndex:
    """What the engine needs from a vector store."""

    backend = BACKEND_SQLITE

    def describe(self, tenant_id: str = "") -> dict[str, Any]:
        return {"backend": self.backend, "healthy": True, "index": ""}

    def available(self) -> bool:
        return True

    def lookup(self, tenant_id: str, bank_id: str) -> dict[str, Sequence[float]] | None:
        """Every vector in the bank, when the index can hand them over cheaply.

        None means "ask search per fact instead", which is what a real vector
        database does: shipping a bank's whole vector set into the API process is
        the cost this module exists to remove.
        """
        return None

    def upsert(self, tenant_id: str, bank_id: str, items: Sequence[VectorItem]) -> int:
        return 0

    def delete(self, tenant_id: str, bank_id: str, unit_ids: Sequence[str]) -> int:
        return 0

    def delete_bank(self, tenant_id: str, bank_id: str) -> int:
        return 0

    def count(self, tenant_id: str, bank_id: str = "") -> int:
        return 0

    def search(
        self,
        tenant_id: str,
        bank_id: str,
        vector: Sequence[float],
        limit: int,
        *,
        kind: str | None = None,
        document_id: str = "",
    ) -> list[tuple[str, float]]:
        return []


class SqliteVectorIndex(BaseVectorIndex):
    """The scan kept as the fallback: cosine over the rows next to the units.

    A single-tenant bank is small enough that reading the vectors back is
    cheaper than operating another service, and a deployment on Infinity has no
    Elasticsearch to index into at all.
    """

    backend = BACKEND_SQLITE

    def __init__(self, store):
        self.store = store

    def describe(self, tenant_id: str = "") -> dict[str, Any]:
        return {"backend": self.backend, "healthy": True, "index": "sqlite:embeddings"}

    def lookup(self, tenant_id: str, bank_id: str) -> dict[str, Sequence[float]] | None:
        return self.store.embeddings(tenant_id, bank_id)

    def search(
        self,
        tenant_id: str,
        bank_id: str,
        vector: Sequence[float],
        limit: int,
        *,
        kind: str | None = None,
        document_id: str = "",
    ) -> list[tuple[str, float]]:
        if vector is None or limit <= 0:
            return []
        vectors = self.store.embeddings(tenant_id, bank_id)
        allowed = None
        if kind or document_id:
            allowed = {
                unit.id
                for unit in self.store.units(tenant_id, bank_id, kind=kind, document_id=document_id or None)
            }
        scored = [
            (unit_id, cosine(vector, other))
            for unit_id, other in vectors.items()
            if allowed is None or unit_id in allowed
        ]
        scored.sort(key=lambda item: -item[1])
        return [item for item in scored[:limit] if item[1] > 0]


class ElasticsearchVectorIndex(BaseVectorIndex):
    """Per-tenant kNN index in the Elasticsearch RAGFlow already runs.

    One index per tenant ('<prefix>_<tenant>') with a filterable 'bank_id', so a
    bank's vectors are one filtered query away and banks never see each other.
    Dimensions are taken from the first vector written: a vector of another size
    cannot be compared with those already indexed, so it is skipped and reported
    rather than silently corrupting similarity scores.
    """

    backend = BACKEND_ELASTICSEARCH
    HEALTH_TTL = 30.0

    def __init__(self, client, *, prefix: str = DEFAULT_INDEX_PREFIX, timeout: float = 10.0):
        self.client = client
        self.prefix = prefix or DEFAULT_INDEX_PREFIX
        self.timeout = timeout
        self._dims: dict[str, int] = {}
        self._created: set[str] = set()
        self._healthy = False
        self._checked_at = 0.0

    # -- naming and health --------------------------------------------

    def index_name(self, tenant_id: str) -> str:
        name = _INDEX_UNSAFE.sub("_", f"{self.prefix}_{tenant_id}".lower()).strip("_")
        return name or DEFAULT_INDEX_PREFIX

    def available(self) -> bool:
        now = time.monotonic()
        if self._checked_at and now - self._checked_at < self.HEALTH_TTL:
            return self._healthy
        try:
            self._healthy = bool(self.client.ping())
        except Exception as exc:  # noqa: BLE001 - an outage must degrade, not raise
            logger.warning("hindsight: vector index unreachable (%s)", exc)
            self._healthy = False
        self._checked_at = now
        return self._healthy

    def describe(self, tenant_id: str = "") -> dict[str, Any]:
        return {
            "backend": self.backend,
            "index": self.index_name(tenant_id) if tenant_id else f"{self.prefix}_<tenant>",
            "healthy": self.available(),
            "dims": sorted(set(self._dims.values())),
        }

    def _exists(self, name: str) -> bool:
        try:
            return bool(self.client.indices.exists(index=name))
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight: cannot inspect vector index %s (%s)", name, exc)
            return False

    def _ensure_index(self, tenant_id: str, dims: int) -> str:
        name = self.index_name(tenant_id)
        known = self._dims.get(name)
        if known is not None and known != dims:
            raise ValueError(f"{name} holds {known}-dimensional vectors, refusing {dims}")
        if name not in self._created:
            if not self._exists(name):
                try:
                    self.client.indices.create(index=name, mappings=_mapping(dims))
                except Exception as exc:  # noqa: BLE001 - a concurrent create is fine
                    if "resource_already_exists" not in str(exc):
                        raise
            self._created.add(name)
        self._dims[name] = dims
        return name

    # -- writes --------------------------------------------------------

    def upsert(self, tenant_id: str, bank_id: str, items: Sequence[VectorItem]) -> int:
        rows = [item for item in items if item.vector]
        if not rows:
            return 0
        dims = len(rows[0].vector)
        try:
            name = self._ensure_index(tenant_id, dims)
        except Exception as exc:  # noqa: BLE001 - the caller falls back to the scan
            logger.warning("hindsight: vector index %s not writable (%s)", self.index_name(tenant_id), exc)
            return 0
        written = 0
        for start in range(0, len(rows), BULK_BATCH):
            written += self._bulk(name, bank_id, rows[start:start + BULK_BATCH], dims)
        return written

    def _bulk(self, name: str, bank_id: str, rows: Sequence[VectorItem], dims: int) -> int:
        operations: list[dict[str, Any]] = []
        accepted = 0
        for item in rows:
            if len(item.vector) != dims:
                logger.warning(
                    "hindsight: %s left out of %s: %d dimensions, index holds %d",
                    item.unit_id, name, len(item.vector), dims,
                )
                continue
            operations.append({"index": {"_index": name, "_id": item.unit_id}})
            operations.append({
                "unit_id": item.unit_id,
                "bank_id": bank_id,
                "kind": item.kind,
                "document_id": item.document_id,
                "tags": list(item.tags),
                EMBEDDING_FIELD: [float(value) for value in item.vector],
            })
            accepted += 1
        if not operations:
            return 0
        try:
            result = self.client.bulk(operations=operations, refresh=REFRESH_POLICY)
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight: bulk index into %s failed (%s)", name, exc)
            return 0
        if isinstance(result, dict) and result.get("errors"):
            failed = sum(
                1 for entry in result.get("items") or []
                if (entry.get("index") or {}).get("error")
            )
            logger.warning("hindsight: %d of %d vectors rejected by %s", failed, accepted, name)
            return accepted - failed
        return accepted

    def delete(self, tenant_id: str, bank_id: str, unit_ids: Sequence[str]) -> int:
        ids = [unit_id for unit_id in unit_ids if unit_id]
        if not ids:
            return 0
        name = self.index_name(tenant_id)
        if name not in self._created and not self._exists(name):
            return 0
        removed = 0
        for start in range(0, len(ids), BULK_BATCH):
            operations: list[dict[str, Any]] = [
                {"delete": {"_index": name, "_id": unit_id}}
                for unit_id in ids[start:start + BULK_BATCH]
            ]
            try:
                result = self.client.bulk(operations=operations, refresh=REFRESH_POLICY)
            except Exception as exc:  # noqa: BLE001
                logger.warning("hindsight: cannot drop vectors from %s (%s)", name, exc)
                return removed
            removed += sum(
                1 for entry in (result or {}).get("items") or []
                if (entry.get("delete") or {}).get("result") == "deleted"
            )
        return removed

    def delete_bank(self, tenant_id: str, bank_id: str) -> int:
        name = self.index_name(tenant_id)
        if name not in self._created and not self._exists(name):
            return 0
        try:
            result = self.client.delete_by_query(
                index=name,
                query={"term": {"bank_id": bank_id}},
                refresh=True,
                conflicts="proceed",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight: cannot clear bank %s from %s (%s)", bank_id, name, exc)
            return 0
        return int((result or {}).get("deleted") or 0)

    # -- reads ---------------------------------------------------------

    def count(self, tenant_id: str, bank_id: str = "") -> int:
        name = self.index_name(tenant_id)
        if name not in self._created and not self._exists(name):
            return 0
        kwargs: dict[str, Any] = {"index": name}
        if bank_id:
            kwargs["query"] = {"term": {"bank_id": bank_id}}
        try:
            return int((self.client.count(**kwargs) or {}).get("count") or 0)
        except Exception as exc:  # noqa: BLE001
            logger.warning("hindsight: cannot count %s (%s)", name, exc)
            return 0

    def search(
        self,
        tenant_id: str,
        bank_id: str,
        vector: Sequence[float],
        limit: int,
        *,
        kind: str | None = None,
        document_id: str = "",
    ) -> list[tuple[str, float]]:
        if vector is None or limit <= 0:
            return []
        name = self.index_name(tenant_id)
        if name not in self._created and not self._exists(name):
            return []
        self._created.add(name)
        filters: list[dict[str, Any]] = [{"term": {"bank_id": bank_id}}]
        if kind:
            filters.append({"term": {"kind": kind}})
        if document_id:
            filters.append({"term": {"document_id": document_id}})
        self._dims.setdefault(name, len(vector))
        try:
            result = self.client.search(
                index=name,
                knn={
                    "field": EMBEDDING_FIELD,
                    "query_vector": [float(value) for value in vector],
                    "k": int(limit),
                    "num_candidates": max(int(limit) * 4, 50),
                    "filter": {"bool": {"filter": filters}},
                },
                size=int(limit),
                source=["unit_id"],
            )
        except Exception as exc:  # noqa: BLE001 - recall degrades to the other arms
            logger.warning("hindsight: kNN search in %s failed (%s)", name, exc)
            return []
        hits = ((result or {}).get("hits") or {}).get("hits") or []
        found: list[tuple[str, float]] = []
        for hit in hits:
            unit_id = str(hit.get("_id") or (hit.get("_source") or {}).get("unit_id") or "")
            if unit_id:
                found.append((unit_id, from_es_score(hit.get("_score") or 0.0)))
        return found


def from_es_score(score: float) -> float:
    """Recover the raw cosine from an Elasticsearch 'cosine' score.

    Elasticsearch reports (1 + cosine) / 2 for a 'cosine' dense_vector, so the
    value has to be mapped back before it meets the thresholds the recall arm and
    the dedup guard are written against.
    """
    return 2.0 * float(score) - 1.0


def _mapping(dims: int) -> dict[str, Any]:
    return {
        "properties": {
            "unit_id": {"type": "keyword"},
            "bank_id": {"type": "keyword"},
            "kind": {"type": "keyword"},
            "document_id": {"type": "keyword"},
            "tags": {"type": "keyword"},
            EMBEDDING_FIELD: {
                "type": "dense_vector",
                "dims": int(dims),
                "index": True,
                "similarity": "cosine",
            },
        }
    }


def _document_store_conf() -> dict[str, Any]:
    """The es block of the deployment config, readable outside the API process.

    common.settings.ES only gets filled by settings.init_settings(), which the API
    server runs on startup but a script, a worker or a test importing the engine
    directly does not. get_base_config returns the same YAML block straight from
    the parsed config file, so the index still finds the document store there.
    """
    try:
        from common import settings

        conf = getattr(settings, "ES", None)
        if isinstance(conf, dict) and conf.get("hosts"):
            return conf
    except Exception:  # noqa: BLE001 - common.settings is not importable everywhere
        pass
    try:
        from common.config_utils import get_base_config

        conf = get_base_config("es", {}) or {}
    except Exception:  # noqa: BLE001 - the engine also runs without RAGFlow config
        return {}
    return conf if isinstance(conf, dict) else {}


def _es_config() -> tuple[str, str, str]:
    """Hosts and credentials of the document store RAGFlow is configured with."""
    hosts = str(os.getenv("HINDSIGHT_ES_HOSTS") or "").strip()
    if hosts:
        return (
            hosts,
            str(os.getenv("HINDSIGHT_ES_USERNAME") or "").strip(),
            str(os.getenv("HINDSIGHT_ES_PASSWORD") or "").strip(),
        )
    conf = _document_store_conf()
    return (
        str(conf.get("hosts") or "").strip(),
        str(conf.get("username") or "").strip(),
        str(conf.get("password") or "").strip(),
    )


def elasticsearch_client() -> Any:
    """Build a client for the configured document store, or None."""
    hosts, username, password = _es_config()
    if not hosts:
        return None
    try:
        from elasticsearch import Elasticsearch
    except Exception as exc:  # noqa: BLE001 - a slim image may not ship the client
        logger.warning("hindsight: the elasticsearch client is unavailable (%s); vectors stay in SQLite", exc)
        return None
    try:
        return Elasticsearch(
            [host.strip() for host in hosts.split(",") if host.strip()],
            basic_auth=(username, password) if username and password else None,
            verify_certs=False,
            timeout=10,
            max_retries=0,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("hindsight: cannot create the elasticsearch client (%s)", exc)
        return None


def build_vector_index(store, *, backend: Any = BACKEND_AUTO, prefix: str = DEFAULT_INDEX_PREFIX) -> BaseVectorIndex:
    """Pick the vector store for this deployment.

    'auto' uses the document store when one is configured, and the SQLite scan
    otherwise. An explicit 'elasticsearch' keeps the Elasticsearch index even
    when it is down, so the failure shows up in status instead of being papered
    over - the engine falls back to the scan while it stays unreachable.
    """
    choice = normalize_backend(backend)
    if choice == BACKEND_SQLITE:
        return SqliteVectorIndex(store)
    client = elasticsearch_client()
    if client is None:
        if choice == BACKEND_ELASTICSEARCH:
            logger.warning(
                "hindsight: vector backend 'elasticsearch' is configured but no document store client could be "
                "built; recall falls back to the SQLite scan"
            )
        return SqliteVectorIndex(store)
    return ElasticsearchVectorIndex(client, prefix=prefix)
