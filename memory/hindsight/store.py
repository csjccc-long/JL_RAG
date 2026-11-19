"""SQLite storage for the native memory engine.

One file holds every bank of every tenant; bank isolation is a WHERE clause, not
a separate database, because a bank is a logical partition (Hindsight models it
the same way) and the console needs to list and compare them.

The schema is deliberately close to the upstream one but flat:

* units      - facts and observations (kind), with tags, source fact ids and the
               three Hindsight timestamps (occurred_start/occurred_end/mentioned_at)
* embeddings - float32 vectors, one row per unit, scanned in Python (banks are
               small enough that a brute-force cosine beats pulling a vector
               extension into the API image)
* entities / unit_entities / links - the graph arm's substrate
* unit_fts   - FTS5 over CJK bigrams plus latin words, i.e. the same tokenisation
               the router already uses, so BM25 ranks Chinese text sensibly
* chunks     - the retain-time chunk of a document (id, index, content hash);
               a fact points back to the chunk it was extracted from, which is
               what makes a re-upload comparable chunk by chunk
* documents / mental_models / directives / pages / operations / audit_logs
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from array import array
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence

SCHEMA_VERSION = 3


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(prefix: str = "") -> str:
    raw = uuid.uuid4().hex
    return f"{prefix}{raw}" if prefix else raw


def _load(raw: Any, default: Any) -> Any:
    if raw in (None, ""):
        return default
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return default
    return value if isinstance(value, type(default)) else default


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _operation_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "tenant_id": row["tenant_id"],
        "bank_id": row["bank_id"],
        "kind": row["kind"],
        "status": row["status"],
        "detail": _load(row["detail_json"], {}),
        "payload": _load(row["payload_json"], {}),
        "attempts": int(row["attempts"] or 0),
        "error": row["error"] or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _webhook_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "url": row["url"],
        "events": _load(row["events_json"], []),
        "secret": row["secret"] or "",
        "active": bool(row["active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def pack_vector(values: Sequence[float]) -> bytes:
    buf = array("f", values)
    return buf.tobytes()


def unpack_vector(raw: bytes) -> list[float]:
    buf = array("f")
    buf.frombytes(raw)
    return list(buf)


@dataclass
class Unit:
    """One fact or observation as stored."""

    id: str
    tenant_id: str
    bank_id: str
    text: str
    kind: str = "fact"
    fact_type: str = "world"
    context: str = ""
    document_id: str = ""
    chunk_id: str = ""
    tags: list[str] = field(default_factory=list)
    source_fact_ids: list[str] = field(default_factory=list)
    proof_count: int = 1
    occurred_start: str | None = None
    occurred_end: str | None = None
    mentioned_at: str | None = None
    consolidated_at: str | None = None
    superseded_by: str | None = None
    fts_rowid: int | None = None
    created_at: str = ""

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Unit":
        return cls(
            id=row["id"],
            tenant_id=row["tenant_id"],
            bank_id=row["bank_id"],
            text=row["text"],
            kind=row["kind"],
            fact_type=row["fact_type"],
            context=row["context"] or "",
            document_id=row["document_id"] or "",
            chunk_id=row["chunk_id"] or "",
            tags=_load(row["tags_json"], []),
            source_fact_ids=_load(row["source_fact_ids_json"], []),
            proof_count=int(row["proof_count"] or 1),
            occurred_start=row["occurred_start"],
            occurred_end=row["occurred_end"],
            mentioned_at=row["mentioned_at"],
            consolidated_at=row["consolidated_at"],
            superseded_by=row["superseded_by"],
            fts_rowid=row["fts_rowid"],
            created_at=row["created_at"] or "",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            # Upstream calls the memory type "world"/"experience"/"observation";
            # keep the storage kind separate so a fact renders as its fact_type.
            "type": self.fact_type if self.kind == "fact" else self.kind,
            "kind": self.kind,
            "fact_type": self.fact_type,
            "context": self.context,
            "document_id": self.document_id or None,
            "chunk_id": self.chunk_id or None,
            "tags": list(self.tags),
            "source_fact_ids": list(self.source_fact_ids),
            "proof_count": self.proof_count,
            "occurred_start": self.occurred_start,
            "occurred_end": self.occurred_end,
            "mentioned_at": self.mentioned_at,
            "consolidated_at": self.consolidated_at,
            "created_at": self.created_at,
        }


class MemoryStore:
    """Thin synchronous SQLite layer; the engine calls it from a worker thread."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # -- plumbing ------------------------------------------------------

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            self._migrate(conn)
            conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """Bring a v1 file up to date without losing what it already holds."""
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(operations)")}
        for name, ddl in (
            ("payload_json", "TEXT NOT NULL DEFAULT '{}'"),
            ("attempts", "INTEGER NOT NULL DEFAULT 0"),
            ("error", "TEXT NOT NULL DEFAULT ''"),
        ):
            if name not in columns:
                conn.execute(f"ALTER TABLE operations ADD COLUMN {name} {ddl}")

    # -- banks ---------------------------------------------------------

    def ensure_bank(self, tenant_id: str, bank_id: str, *, name: str = "") -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO banks(tenant_id, bank_id, name, created_at) VALUES(?,?,?,?) "
                "ON CONFLICT(tenant_id, bank_id) DO NOTHING",
                (tenant_id, bank_id, name or bank_id, utcnow()),
            )

    def all_banks(self) -> list[dict[str, Any]]:
        """Every bank in the file, for the background refresh loop."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT tenant_id, bank_id, name, mission, created_at FROM banks ORDER BY created_at"
            ).fetchall()
        return [dict(row) for row in rows]

    def list_banks(self, tenant_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT b.*, "
                "(SELECT COUNT(*) FROM units u WHERE u.tenant_id=b.tenant_id AND u.bank_id=b.bank_id) AS units "
                "FROM banks b WHERE b.tenant_id=? ORDER BY b.created_at",
                (tenant_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_bank(self, tenant_id: str, bank_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM banks WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id)
            ).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["config"] = _load(data.get("config_json"), {})
        return data

    def patch_bank(self, tenant_id: str, bank_id: str, *, name: str | None = None,
                   mission: str | None = None, config: dict[str, Any] | None = None) -> None:
        sets, params = [], []
        if name is not None:
            sets.append("name=?")
            params.append(name)
        if mission is not None:
            sets.append("mission=?")
            params.append(mission)
        if config is not None:
            sets.append("config_json=?")
            params.append(_dump(config))
        if not sets:
            return
        params.extend([tenant_id, bank_id])
        with self.connect() as conn:
            conn.execute(f"UPDATE banks SET {', '.join(sets)} WHERE tenant_id=? AND bank_id=?", params)

    def delete_bank(self, tenant_id: str, bank_id: str) -> None:
        with self.connect() as conn:
            ids = [row["id"] for row in conn.execute(
                "SELECT id FROM units WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))]
            for table in ("embeddings", "unit_entities", "links"):
                column = "unit_id" if table != "links" else "from_unit"
                conn.executemany(f"DELETE FROM {table} WHERE {column}=?", [(i,) for i in ids])
            conn.execute("DELETE FROM unit_fts WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM units WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM chunks WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM documents WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM entities WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM mental_models WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM directives WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM pages WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))
            conn.execute("DELETE FROM banks WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id))

    # -- documents -----------------------------------------------------

    def upsert_document(self, tenant_id: str, bank_id: str, document_id: str, content: str,
                        *, tags: Iterable[str] = (), metadata: dict[str, Any] | None = None) -> bool:
        """Store a document; return False when the same content is already there."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT content FROM documents WHERE tenant_id=? AND bank_id=? AND document_id=?",
                (tenant_id, bank_id, document_id),
            ).fetchone()
            if row and row["content"] == content:
                return False
            conn.execute(
                "INSERT INTO documents(tenant_id, bank_id, document_id, content, tags_json, metadata_json, created_at) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id, bank_id, document_id) DO UPDATE SET "
                "content=excluded.content, tags_json=excluded.tags_json, metadata_json=excluded.metadata_json",
                (tenant_id, bank_id, document_id, content, _dump(list(tags)), _dump(metadata or {}), utcnow()),
            )
        return True

    def list_documents(self, tenant_id: str, bank_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT d.document_id, substr(d.content, 1, 400) AS preview, d.tags_json, d.metadata_json, "
                "d.created_at, (SELECT COUNT(*) FROM chunks c WHERE c.tenant_id=d.tenant_id "
                "AND c.bank_id=d.bank_id AND c.document_id=d.document_id) AS chunk_count "
                "FROM documents d WHERE d.tenant_id=? AND d.bank_id=? ORDER BY d.created_at DESC LIMIT ?",
                (tenant_id, bank_id, limit),
            ).fetchall()
        return [
            {
                "document_id": row["document_id"],
                "preview": row["preview"],
                "tags": _load(row["tags_json"], []),
                "metadata": _load(row["metadata_json"], {}),
                "created_at": row["created_at"],
                "chunk_count": int(row["chunk_count"] or 0),
            }
            for row in rows
        ]

    # -- chunks --------------------------------------------------------

    def replace_chunks(self, tenant_id: str, bank_id: str, document_id: str,
                       chunks: Sequence[str]) -> list[dict[str, Any]]:
        """Store the document's chunks, replacing whatever an earlier upload left.

        Chunk identity is the content hash, exactly as in Hindsight: the same text
        at the same index keeps its id, which is what a delta re-ingest compares.
        The units extracted from the replaced chunks are dropped too, so a body
        edited on disk does not leave facts that quote the version it replaced.
        """
        stamp = utcnow()
        rows: list[dict[str, Any]] = []
        with self.connect() as conn:
            old_ids = [row["chunk_id"] for row in conn.execute(
                "SELECT chunk_id FROM chunks WHERE tenant_id=? AND bank_id=? AND document_id=?",
                (tenant_id, bank_id, document_id),
            )]
            conn.execute("DELETE FROM chunks WHERE tenant_id=? AND bank_id=? AND document_id=?",
                         (tenant_id, bank_id, document_id))
            if old_ids:
                placeholders = ",".join("?" for _ in old_ids)
                unit_ids = [row["id"] for row in conn.execute(
                    f"SELECT id FROM units WHERE tenant_id=? AND bank_id=? AND chunk_id IN ({placeholders})",
                    (tenant_id, bank_id, *old_ids),
                )]
                for unit_id in unit_ids:
                    conn.execute("DELETE FROM embeddings WHERE unit_id=?", (unit_id,))
                    conn.execute("DELETE FROM unit_entities WHERE unit_id=?", (unit_id,))
                    conn.execute("DELETE FROM links WHERE from_unit=? OR to_unit=?", (unit_id, unit_id))
                    conn.execute("DELETE FROM units WHERE id=?", (unit_id,))
            for index, text in enumerate(chunks):
                content_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
                row = {
                    "tenant_id": tenant_id,
                    "bank_id": bank_id,
                    "document_id": document_id,
                    # Index in the id: two chunks of one document may carry identical
                    # text, and get_chunk(chunk_id) must still resolve one row.
                    "chunk_id": f"chk_{content_hash[:20]}_{index}",
                    "chunk_index": index,
                    "chunk_text": text,
                    "content_hash": content_hash,
                    "created_at": stamp,
                }
                conn.execute(
                    "INSERT INTO chunks(tenant_id, bank_id, document_id, chunk_id, chunk_index, chunk_text, "
                    "content_hash, created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (tenant_id, bank_id, document_id, row["chunk_id"], index, text, content_hash, stamp),
                )
                rows.append(row)
        return rows

    def list_chunks(self, tenant_id: str, bank_id: str, document_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT chunk_id, chunk_index, chunk_text, content_hash, created_at FROM chunks "
                "WHERE tenant_id=? AND bank_id=? AND document_id=? ORDER BY chunk_index",
                (tenant_id, bank_id, document_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def delete_document(self, tenant_id: str, bank_id: str, document_id: str) -> int:
        """Drop a document with everything derived from it, chunks included.

        Deleting only the facts would leave the chunk rows (and the document row)
        behind, so a re-upload of the same id silently kept the old chunk list.
        """
        with self.connect() as conn:
            unit_ids = [row["id"] for row in conn.execute(
                "SELECT id FROM units WHERE tenant_id=? AND bank_id=? AND document_id=?",
                (tenant_id, bank_id, document_id),
            )]
            for unit_id in unit_ids:
                conn.execute("DELETE FROM embeddings WHERE unit_id=?", (unit_id,))
                conn.execute("DELETE FROM unit_entities WHERE unit_id=?", (unit_id,))
                conn.execute("DELETE FROM links WHERE from_unit=? OR to_unit=?", (unit_id, unit_id))
                conn.execute("DELETE FROM units WHERE id=?", (unit_id,))
            conn.execute("DELETE FROM chunks WHERE tenant_id=? AND bank_id=? AND document_id=?",
                         (tenant_id, bank_id, document_id))
            conn.execute("DELETE FROM documents WHERE tenant_id=? AND bank_id=? AND document_id=?",
                         (tenant_id, bank_id, document_id))
        return len(unit_ids)

    def get_chunk(self, tenant_id: str, bank_id: str, chunk_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT chunk_id, document_id, chunk_index, chunk_text, content_hash, created_at FROM chunks "
                "WHERE tenant_id=? AND bank_id=? AND chunk_id=?",
                (tenant_id, bank_id, chunk_id),
            ).fetchone()
        return dict(row) if row else None

    def get_document(self, tenant_id: str, bank_id: str, document_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT document_id, content, tags_json, metadata_json, created_at FROM documents "
                "WHERE tenant_id=? AND bank_id=? AND document_id=?",
                (tenant_id, bank_id, document_id),
            ).fetchone()
        if row is None:
            return None
        return {
            "document_id": row["document_id"],
            "content": row["content"],
            "tags": _load(row["tags_json"], []),
            "metadata": _load(row["metadata_json"], {}),
            "created_at": row["created_at"],
        }

    # -- units ---------------------------------------------------------

    def insert_unit(self, unit: Unit, tokens: str, vector: Sequence[float] | None) -> Unit:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO units(id, tenant_id, bank_id, kind, text, fact_type, context, document_id, chunk_id, "
                "tags_json, source_fact_ids_json, proof_count, occurred_start, occurred_end, mentioned_at, "
                "consolidated_at, superseded_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    unit.id, unit.tenant_id, unit.bank_id, unit.kind, unit.text, unit.fact_type, unit.context,
                    unit.document_id, unit.chunk_id, _dump(unit.tags), _dump(unit.source_fact_ids),
                    unit.proof_count, unit.occurred_start, unit.occurred_end, unit.mentioned_at,
                    unit.consolidated_at, unit.superseded_by, unit.created_at or utcnow(),
                ),
            )
            if vector:
                conn.execute(
                    "INSERT OR REPLACE INTO embeddings(unit_id, dim, vec) VALUES(?,?,?)",
                    (unit.id, len(vector), pack_vector(vector)),
                )
            if tokens:
                cur = conn.execute(
                    "INSERT INTO unit_fts(unit_id, tenant_id, bank_id, tokens) VALUES(?,?,?,?)",
                    (unit.id, unit.tenant_id, unit.bank_id, tokens),
                )
                conn.execute("UPDATE units SET fts_rowid=? WHERE id=?", (cur.lastrowid, unit.id))
                unit.fts_rowid = int(cur.lastrowid)
        return unit

    def delete_unit(self, unit_id: str) -> bool:
        with self.connect() as conn:
            row = conn.execute("SELECT fts_rowid FROM units WHERE id=?", (unit_id,)).fetchone()
            if row is None:
                return False
            if row["fts_rowid"] is not None:
                conn.execute("DELETE FROM unit_fts WHERE rowid=?", (row["fts_rowid"],))
            conn.execute("DELETE FROM embeddings WHERE unit_id=?", (unit_id,))
            conn.execute("DELETE FROM unit_entities WHERE unit_id=?", (unit_id,))
            conn.execute("DELETE FROM links WHERE from_unit=? OR to_unit=?", (unit_id, unit_id))
            conn.execute("DELETE FROM units WHERE id=?", (unit_id,))
        return True

    def update_unit(self, unit_id: str, **fields: Any) -> None:
        allowed = {
            "text", "kind", "fact_type", "context", "tags_json", "source_fact_ids_json", "proof_count",
            "occurred_start", "occurred_end", "mentioned_at", "consolidated_at", "superseded_by",
        }
        sets, params = [], []
        for key, value in fields.items():
            if key not in allowed:
                raise ValueError(f"cannot update units.{key}")
            sets.append(f"{key}=?")
            params.append(value)
        if not sets:
            return
        params.append(unit_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE units SET {', '.join(sets)} WHERE id=?", params)

    def get_unit(self, unit_id: str) -> Unit | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM units WHERE id=?", (unit_id,)).fetchone()
        return Unit.from_row(row) if row else None

    def units(self, tenant_id: str, bank_id: str, *, kind: str | None = None,
              include_consolidated: bool = True, limit: int | None = None,
              document_id: str | None = None) -> list[Unit]:
        sql = "SELECT * FROM units WHERE tenant_id=? AND bank_id=?"
        params: list[Any] = [tenant_id, bank_id]
        if kind:
            sql += " AND kind=?"
            params.append(kind)
        if document_id:
            sql += " AND document_id=?"
            params.append(document_id)
        if not include_consolidated:
            sql += " AND consolidated_at IS NULL AND superseded_by IS NULL"
        sql += " ORDER BY COALESCE(occurred_start, mentioned_at, created_at) DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [Unit.from_row(row) for row in rows]

    def embeddings(self, tenant_id: str, bank_id: str) -> dict[str, list[float]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT e.unit_id, e.vec FROM embeddings e JOIN units u ON u.id=e.unit_id "
                "WHERE u.tenant_id=? AND u.bank_id=?",
                (tenant_id, bank_id),
            ).fetchall()
        return {row["unit_id"]: unpack_vector(row["vec"]) for row in rows}

    def fts_search(self, tenant_id: str, bank_id: str, match: str, limit: int) -> list[tuple[str, float]]:
        if not match.strip():
            return []
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT unit_id, bm25(unit_fts) AS score FROM unit_fts "
                "WHERE unit_fts MATCH ? AND tenant_id=? AND bank_id=? ORDER BY score LIMIT ?",
                (match, tenant_id, bank_id, limit),
            ).fetchall()
        return [(row["unit_id"], -float(row["score"])) for row in rows]

    def add_entities(self, tenant_id: str, bank_id: str, unit_id: str, names: Iterable[str]) -> None:
        now = utcnow()
        with self.connect() as conn:
            for name in names:
                label = (name or "").strip()
                if not label:
                    continue
                conn.execute(
                    "INSERT INTO entities(tenant_id, bank_id, name, created_at) VALUES(?,?,?,?) "
                    "ON CONFLICT(tenant_id, bank_id, name) DO NOTHING",
                    (tenant_id, bank_id, label, now),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO unit_entities(unit_id, entity_name) VALUES(?,?)",
                    (unit_id, label),
                )

    def add_link(self, tenant_id: str, bank_id: str, from_unit: str, to_unit: str,
                 relation: str, weight: float = 1.0) -> None:
        if from_unit == to_unit:
            return
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO links(tenant_id, bank_id, from_unit, to_unit, relation, weight, created_at) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id, bank_id, from_unit, to_unit, relation) "
                "DO UPDATE SET weight=MAX(links.weight, excluded.weight)",
                (tenant_id, bank_id, from_unit, to_unit, relation, weight, utcnow()),
            )

    def entities(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT e.name, COUNT(ue.unit_id) AS mentions FROM entities e "
                "LEFT JOIN unit_entities ue ON ue.entity_name=e.name AND ue.unit_id IN "
                "(SELECT id FROM units WHERE tenant_id=? AND bank_id=?) "
                "WHERE e.tenant_id=? AND e.bank_id=? GROUP BY e.name ORDER BY mentions DESC",
                (tenant_id, bank_id, tenant_id, bank_id),
            ).fetchall()
        return [{"name": row["name"], "mentions": row["mentions"]} for row in rows]

    def unit_entities(self, tenant_id: str, bank_id: str) -> dict[str, list[str]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT ue.unit_id, ue.entity_name FROM unit_entities ue JOIN units u ON u.id=ue.unit_id "
                "WHERE u.tenant_id=? AND u.bank_id=?",
                (tenant_id, bank_id),
            ).fetchall()
        out: dict[str, list[str]] = {}
        for row in rows:
            out.setdefault(row["unit_id"], []).append(row["entity_name"])
        return out

    def links(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT from_unit, to_unit, relation, weight FROM links WHERE tenant_id=? AND bank_id=?",
                (tenant_id, bank_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def tags(self, tenant_id: str, bank_id: str) -> list[str]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT tags_json FROM units WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id)
            ).fetchall()
        seen: set[str] = set()
        for row in rows:
            seen.update(_load(row["tags_json"], []))
        return sorted(seen)

    def stats(self, tenant_id: str, bank_id: str) -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS total, "
                "SUM(CASE WHEN kind='fact' THEN 1 ELSE 0 END) AS facts, "
                "SUM(CASE WHEN kind='observation' THEN 1 ELSE 0 END) AS observations, "
                "SUM(CASE WHEN consolidated_at IS NOT NULL THEN 1 ELSE 0 END) AS consolidated "
                "FROM units WHERE tenant_id=? AND bank_id=?",
                (tenant_id, bank_id),
            ).fetchone()
            docs = conn.execute(
                "SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id)
            ).fetchone()
            ents = conn.execute(
                "SELECT COUNT(*) AS n FROM entities WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id)
            ).fetchone()
            links = conn.execute(
                "SELECT COUNT(*) AS n FROM links WHERE tenant_id=? AND bank_id=?", (tenant_id, bank_id)
            ).fetchone()
        return {
            "memories": int(row["total"] or 0),
            "facts": int(row["facts"] or 0),
            "observations": int(row["observations"] or 0),
            "consolidated": int(row["consolidated"] or 0),
            "documents": int(docs["n"] or 0),
            "entities": int(ents["n"] or 0),
            "links": int(links["n"] or 0),
        }

    # -- mental models -------------------------------------------------

    def upsert_mental_model(self, tenant_id: str, bank_id: str, model_id: str, *,
                            name: str, source_query: str, content: str, max_tokens: int) -> dict[str, Any]:
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO mental_models(id, tenant_id, bank_id, name, source_query, content, max_tokens, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, "
                "source_query=excluded.source_query, content=excluded.content, max_tokens=excluded.max_tokens, "
                "updated_at=excluded.updated_at",
                (model_id, tenant_id, bank_id, name, source_query, content, max_tokens, now, now),
            )
        return {"id": model_id, "name": name, "source_query": source_query, "content": content,
                "max_tokens": max_tokens, "updated_at": now}

    def mental_models(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, name, source_query, content, max_tokens, updated_at FROM mental_models "
                "WHERE tenant_id=? AND bank_id=? ORDER BY updated_at DESC",
                (tenant_id, bank_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_mental_model(self, tenant_id: str, bank_id: str, model_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM mental_models WHERE id=? AND tenant_id=? AND bank_id=?",
                (model_id, tenant_id, bank_id),
            ).fetchone()
        return dict(row) if row else None

    def delete_mental_model(self, tenant_id: str, bank_id: str, model_id: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM mental_models WHERE id=? AND tenant_id=? AND bank_id=?",
                (model_id, tenant_id, bank_id),
            )

    def stale_mental_models(self, tenant_id: str, bank_id: str, *, hours: int = 24,
                            limit: int = 20) -> list[dict[str, Any]]:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max(1, hours))).isoformat(timespec="seconds")
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM mental_models WHERE tenant_id=? AND bank_id=? AND updated_at<? "
                "ORDER BY updated_at LIMIT ?",
                (tenant_id, bank_id, cutoff, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    # -- directives ----------------------------------------------------

    def add_directive(self, tenant_id: str, bank_id: str, content: str, priority: int = 1,
                      tags: Iterable[str] = ()) -> dict[str, Any]:
        directive_id = new_id()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO directives(id, tenant_id, bank_id, content, priority, tags_json, created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (directive_id, tenant_id, bank_id, content, priority, _dump(list(tags)), utcnow()),
            )
        return {"id": directive_id, "content": content, "priority": priority, "tags": list(tags)}

    def directives(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, content, priority, tags_json FROM directives WHERE tenant_id=? AND bank_id=? "
                "ORDER BY priority DESC, created_at",
                (tenant_id, bank_id),
            ).fetchall()
        return [
            {"id": row["id"], "content": row["content"], "priority": row["priority"],
             "tags": _load(row["tags_json"], [])}
            for row in rows
        ]

    def delete_directive(self, tenant_id: str, bank_id: str, directive_id: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM directives WHERE id=? AND tenant_id=? AND bank_id=?",
                (directive_id, tenant_id, bank_id),
            )

    # -- pages ---------------------------------------------------------

    def add_page(self, tenant_id: str, bank_id: str, title: str, content: str,
                 *, parent_id: str = "", tags: Iterable[str] = ()) -> dict[str, Any]:
        page_id = new_id()
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO pages(id, tenant_id, bank_id, parent_id, title, content, tags_json, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (page_id, tenant_id, bank_id, parent_id, title, content, _dump(list(tags)), now, now),
            )
        return {"id": page_id, "title": title, "parent_id": parent_id, "content": content,
                "tags": list(tags), "updated_at": now}

    def pages(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT id, parent_id, title, content, tags_json, updated_at FROM pages "
                "WHERE tenant_id=? AND bank_id=? ORDER BY updated_at DESC",
                (tenant_id, bank_id),
            ).fetchall()
        return [
            {"id": row["id"], "parent_id": row["parent_id"], "title": row["title"],
             "content": row["content"], "tags": _load(row["tags_json"], []),
             "updated_at": row["updated_at"]}
            for row in rows
        ]

    def delete_page(self, tenant_id: str, bank_id: str, page_id: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM pages WHERE id=? AND tenant_id=? AND bank_id=?", (page_id, tenant_id, bank_id))

    # -- aliases -------------------------------------------------------

    def add_alias(self, tenant_id: str, bank_id: str, alias: str, canonical: str) -> dict[str, Any]:
        label = (alias or "").strip()
        target = (canonical or "").strip()
        if not label or not target:
            raise ValueError("alias and canonical are required")
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO aliases(tenant_id, bank_id, alias, canonical, created_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(tenant_id, bank_id, alias) DO UPDATE SET canonical=excluded.canonical",
                (tenant_id, bank_id, label, target, now),
            )
        return {"alias": label, "canonical": target, "created_at": now}

    def aliases(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT alias, canonical, created_at FROM aliases WHERE tenant_id=? AND bank_id=? "
                "ORDER BY alias",
                (tenant_id, bank_id),
            ).fetchall()
        return [dict(row) for row in rows]

    def alias_map(self, tenant_id: str, bank_id: str) -> dict[str, str]:
        return {row["alias"].lower(): row["canonical"] for row in self.aliases(tenant_id, bank_id)}

    def delete_alias(self, tenant_id: str, bank_id: str, alias: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM aliases WHERE tenant_id=? AND bank_id=? AND alias=?",
                (tenant_id, bank_id, alias),
            )

    # -- webhooks ------------------------------------------------------

    def add_webhook(self, tenant_id: str, bank_id: str, url: str, *,
                    events: Iterable[str] = (), secret: str = "") -> dict[str, Any]:
        webhook_id = new_id("wh_")
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO webhooks(id, tenant_id, bank_id, url, events_json, secret, active, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (webhook_id, tenant_id, bank_id, url, _dump(list(events)), secret, 1, now, now),
            )
        return {"id": webhook_id, "url": url, "events": list(events), "secret": secret,
                "active": True, "created_at": now, "updated_at": now}

    def webhooks(self, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM webhooks WHERE tenant_id=? AND bank_id=? ORDER BY created_at",
                (tenant_id, bank_id),
            ).fetchall()
        return [_webhook_row(row) for row in rows]

    def get_webhook(self, tenant_id: str, bank_id: str, webhook_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM webhooks WHERE id=? AND tenant_id=? AND bank_id=?",
                (webhook_id, tenant_id, bank_id),
            ).fetchone()
        return _webhook_row(row) if row else None

    def set_webhook_active(self, tenant_id: str, bank_id: str, webhook_id: str, active: bool) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE webhooks SET active=?, updated_at=? WHERE id=? AND tenant_id=? AND bank_id=?",
                (1 if active else 0, utcnow(), webhook_id, tenant_id, bank_id),
            )

    def delete_webhook(self, tenant_id: str, bank_id: str, webhook_id: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM webhooks WHERE id=? AND tenant_id=? AND bank_id=?",
                (webhook_id, tenant_id, bank_id),
            )
            conn.execute("DELETE FROM webhook_deliveries WHERE webhook_id=?", (webhook_id,))

    def add_delivery(self, webhook_id: str, tenant_id: str, bank_id: str, event: str,
                     payload: dict[str, Any] | None = None) -> str:
        delivery_id = new_id("dl_")
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO webhook_deliveries(id, webhook_id, tenant_id, bank_id, event, status, "
                "attempts, response_code, error, payload_json, created_at, updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (delivery_id, webhook_id, tenant_id, bank_id, event, "pending", 0, 0, "",
                 _dump(payload or {}), now, now),
            )
        return delivery_id

    def finish_delivery(self, delivery_id: str, *, status: str, attempts: int,
                        response_code: int = 0, error: str = "") -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE webhook_deliveries SET status=?, attempts=?, response_code=?, error=?, updated_at=? "
                "WHERE id=?",
                (status, attempts, response_code, error[:500], utcnow(), delivery_id),
            )

    def deliveries(self, tenant_id: str, bank_id: str, webhook_id: str = "",
                   *, limit: int = 20) -> list[dict[str, Any]]:
        sql = ("SELECT id, webhook_id, event, status, attempts, response_code, error, created_at, updated_at "
               "FROM webhook_deliveries WHERE tenant_id=? AND bank_id=?")
        params: list[Any] = [tenant_id, bank_id]
        if webhook_id:
            sql += " AND webhook_id=?"
            params.append(webhook_id)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    # -- operations and audit -----------------------------------------

    def create_operation(self, tenant_id: str, bank_id: str, kind: str,
                         payload: dict[str, Any] | None = None, *,
                         status: str = "running") -> str:
        operation_id = new_id("op_")
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO operations(id, tenant_id, bank_id, kind, status, detail_json, payload_json, "
                "attempts, error, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (operation_id, tenant_id, bank_id, kind, status, "{}", _dump(payload or {}), 0, "",
                 utcnow(), utcnow()),
            )
        return operation_id

    def finish_operation(self, operation_id: str, *, status: str,
                         detail: dict[str, Any] | None = None, error: str = "",
                         attempts: int | None = None) -> None:
        sets = ["status=?", "detail_json=?", "error=?", "updated_at=?"]
        params: list[Any] = [status, _dump(detail or {}), error[:1000], utcnow()]
        if attempts is not None:
            sets.append("attempts=?")
            params.append(int(attempts))
        params.append(operation_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE operations SET {', '.join(sets)} WHERE id=?", params)

    def get_operation(self, operation_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM operations WHERE id=?", (operation_id,)).fetchone()
        return _operation_row(row) if row else None

    def operations(self, tenant_id: str, bank_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM operations WHERE tenant_id=? AND bank_id=? ORDER BY created_at DESC LIMIT ?",
                (tenant_id, bank_id, limit),
            ).fetchall()
        return [_operation_row(row) for row in rows]

    def recover_operations(self, *, limit: int = 50) -> list[str]:
        """Close the orphans a previous process left and return the rest.

        A restart can strand a row in queued/running. Rows whose bank still
        exists are returned so the queue can finish them; rows whose bank was
        deleted while they waited are failed here, otherwise the panel shows a
        job "running" forever with nowhere to write.
        """
        with self.connect() as conn:
            conn.execute(
                "UPDATE operations SET status='failed', error='bank deleted', updated_at=? "
                "WHERE status IN ('queued','running') AND NOT EXISTS ("
                "SELECT 1 FROM banks b WHERE b.tenant_id=operations.tenant_id "
                "AND b.bank_id=operations.bank_id)",
                (utcnow(),),
            )
            rows = conn.execute(
                "SELECT o.id FROM operations o JOIN banks b "
                "ON b.tenant_id=o.tenant_id AND b.bank_id=o.bank_id "
                "WHERE o.status IN ('queued','running') ORDER BY o.created_at LIMIT ?",
                (limit,),
            ).fetchall()
        return [row["id"] for row in rows]

    def operation_counts(self, tenant_id: str = "", bank_id: str = "") -> dict[str, int]:
        clauses: list[str] = []
        params: list[Any] = []
        if tenant_id:
            clauses.append("tenant_id=?")
            params.append(tenant_id)
        if bank_id:
            clauses.append("bank_id=?")
            params.append(bank_id)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        with self.connect() as conn:
            rows = conn.execute(
                f"SELECT status, COUNT(*) AS n FROM operations{where} GROUP BY status", params
            ).fetchall()
        return {row["status"]: int(row["n"]) for row in rows}

    def audit(self, tenant_id: str, bank_id: str, action: str, detail: dict[str, Any] | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO audit_logs(tenant_id, bank_id, action, detail_json, created_at) VALUES(?,?,?,?,?)",
                (tenant_id, bank_id, action, _dump(detail or {}), utcnow()),
            )

    def audit_logs(self, tenant_id: str, bank_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT action, detail_json, created_at FROM audit_logs WHERE tenant_id=? AND bank_id=? "
                "ORDER BY id DESC LIMIT ?",
                (tenant_id, bank_id, limit),
            ).fetchall()
        return [
            {"action": row["action"], "detail": _load(row["detail_json"], {}), "created_at": row["created_at"]}
            for row in rows
        ]

    # -- retention -----------------------------------------------------
    def prune(self, tenant_id: str, bank_id: str, *, days: int = 90,
              dry_run: bool = False, collect_ids: bool = False) -> dict[str, Any]:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, days))).isoformat(timespec="seconds")
        with self.connect() as conn:
            unit_ids = [row["id"] for row in conn.execute(
                "SELECT id FROM units WHERE tenant_id=? AND bank_id=? AND created_at<?",
                (tenant_id, bank_id, cutoff),
            )]
            documents = conn.execute(
                "SELECT COUNT(*) AS n FROM documents WHERE tenant_id=? AND bank_id=? AND created_at<?",
                (tenant_id, bank_id, cutoff),
            ).fetchone()["n"]
            operations = conn.execute(
                "SELECT COUNT(*) AS n FROM operations WHERE tenant_id=? AND bank_id=? AND updated_at<?",
                (tenant_id, bank_id, cutoff),
            ).fetchone()["n"]
            audits = conn.execute(
                "SELECT COUNT(*) AS n FROM audit_logs WHERE tenant_id=? AND bank_id=? AND created_at<?",
                (tenant_id, bank_id, cutoff),
            ).fetchone()["n"]
        counts: dict[str, Any] = {
            "memories": len(unit_ids),
            "documents": int(documents),
            "operations": int(operations),
            "audit_logs": int(audits),
        }
        if collect_ids:
            # The caller has to drop the same units from the vector index, and
            # only this query knows which ones the cutoff selects.
            counts["unit_ids"] = unit_ids
        if dry_run:
            return counts
        for unit_id in unit_ids:
            self.delete_unit(unit_id)
        with self.connect() as conn:
            conn.execute(
                "DELETE FROM documents WHERE tenant_id=? AND bank_id=? AND created_at<?",
                (tenant_id, bank_id, cutoff),
            )
            conn.execute(
                "DELETE FROM operations WHERE tenant_id=? AND bank_id=? AND updated_at<?",
                (tenant_id, bank_id, cutoff),
            )
            conn.execute(
                "DELETE FROM audit_logs WHERE tenant_id=? AND bank_id=? AND created_at<?",
                (tenant_id, bank_id, cutoff),
            )
        return counts


SCHEMA = """
CREATE TABLE IF NOT EXISTS banks(
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    mission TEXT NOT NULL DEFAULT '',
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, bank_id)
);

CREATE TABLE IF NOT EXISTS units(
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'fact',
    text TEXT NOT NULL,
    fact_type TEXT NOT NULL DEFAULT 'world',
    context TEXT NOT NULL DEFAULT '',
    document_id TEXT NOT NULL DEFAULT '',
    chunk_id TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    source_fact_ids_json TEXT NOT NULL DEFAULT '[]',
    proof_count INTEGER NOT NULL DEFAULT 1,
    occurred_start TEXT,
    occurred_end TEXT,
    mentioned_at TEXT,
    consolidated_at TEXT,
    superseded_by TEXT,
    fts_rowid INTEGER,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_units_bank ON units(tenant_id, bank_id, kind);
CREATE INDEX IF NOT EXISTS idx_units_document ON units(tenant_id, bank_id, document_id);

CREATE TABLE IF NOT EXISTS embeddings(
    unit_id TEXT PRIMARY KEY,
    dim INTEGER NOT NULL,
    vec BLOB NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS unit_fts USING fts5(
    unit_id UNINDEXED,
    tenant_id UNINDEXED,
    bank_id UNINDEXED,
    tokens
);

CREATE TABLE IF NOT EXISTS entities(
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, bank_id, name)
);

CREATE TABLE IF NOT EXISTS unit_entities(
    unit_id TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    PRIMARY KEY(unit_id, entity_name)
);

CREATE TABLE IF NOT EXISTS links(
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    from_unit TEXT NOT NULL,
    to_unit TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'co_occurrence',
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, bank_id, from_unit, to_unit, relation)
);

CREATE TABLE IF NOT EXISTS documents(
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    content TEXT NOT NULL,
    tags_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, bank_id, document_id)
);

CREATE TABLE IF NOT EXISTS chunks(
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, bank_id, document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(tenant_id, bank_id, document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_id ON chunks(tenant_id, bank_id, chunk_id);

CREATE TABLE IF NOT EXISTS mental_models(
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_query TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    max_tokens INTEGER NOT NULL DEFAULT 600,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directives(
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    content TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 1,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages(
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    parent_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations(
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    detail_json TEXT NOT NULL DEFAULT '{}',
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases(
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    canonical TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id, bank_id, alias)
);

CREATE TABLE IF NOT EXISTS webhooks(
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    url TEXT NOT NULL,
    events_json TEXT NOT NULL DEFAULT '[]',
    secret TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries(
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    event TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    response_code INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""
