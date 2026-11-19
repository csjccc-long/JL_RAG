"""Native Hindsight backend: the engine inside RAGFlow, no sidecar.

This is a thin adapter over memory/hindsight/, a source-level port of the
upstream engine: SQLite storage, LLM fact extraction, four-arm recall and
consolidation all run in this process, with the tenant's own chat and embedding
models.

What remains here is the part the router needs - two verbs and the tenant
lookup - plus the handles the management API uses. Everything expensive is
delegated, so a missing model or an empty bank degrades to "no memories".
"""

from __future__ import annotations

import logging
import re
from typing import Any

from memory.backends.base import MemoryRecord
from memory.config import HindsightSettings
from memory.hindsight.engine import HindsightEngine, get_hindsight_engine
from memory.hindsight.llm import NullProviders, Providers, RagflowProviders

logger = logging.getLogger(__name__)

# RAGFlow answers "no relevant content" when nothing was retrieved. Retaining
# that answer teaches the bank that the assistant is ignorant, which is noise:
# the turn is stored as the user's own statement instead.
_REFUSAL = re.compile(
    r"not found in the dataset|no relevant content was found|"
    r"i (?:do not|don't) know|unable to (?:answer|find)|cannot (?:answer|find)|"
    r"没有找到相关|未找到相关|无法回答|我不(?:知道|清楚)",
    re.IGNORECASE,
)


def _is_refusal(text: str) -> bool:
    return bool(_REFUSAL.search(text or ""))


class HindsightBackend:
    """Router-facing adapter over the native engine."""

    name = "hindsight"

    def __init__(self, settings: HindsightSettings | None = None, **overrides: Any):
        base = settings or HindsightSettings()
        self.settings = base
        self.bank = overrides.get("bank") or base.bank
        self.tags = tuple(overrides.get("tags") or base.tags)
        self.top_k = int(overrides.get("top_k") or base.top_k)
        self.max_tokens = int(overrides.get("max_tokens") or base.max_tokens)
        self.prefer_observations = bool(
            overrides.get("prefer_observations", base.prefer_observations)
        )
        self.retain_async = bool(overrides.get("retain_async", base.retain_async))
        db_path = overrides.get("db_path") or base.db_path
        self._engine: HindsightEngine | None = None
        if db_path:
            self._engine = HindsightEngine(
                db_path,
                default_bank=self.bank,
                budget=base.budget,
                max_tokens=self.max_tokens,
                top_k=self.top_k,
                defense=base.defense,
                consolidate_after=base.consolidate_after,
                chunk_chars=base.chunk_chars,
                vector_backend=base.vector_backend,
                vector_index_prefix=base.vector_index_prefix,
            )

    # -- engine --------------------------------------------------------

    @property
    def engine(self) -> HindsightEngine:
        if self._engine is None:
            self._engine = get_hindsight_engine()
        return self._engine

    @property
    def enabled(self) -> bool:
        return True

    def providers(self, tenant_id: str) -> Providers:
        return RagflowProviders(tenant_id) if tenant_id else NullProviders()

    def status(self) -> dict[str, Any]:
        status = self.engine.status()
        status.update({
            "enabled": self.enabled,
            "bank": self.bank,
            "top_k": self.top_k,
            "max_tokens": self.max_tokens,
            "retain_async": self.retain_async,
            "prefer_observations": self.prefer_observations,
        })
        return status

    # -- router contract ----------------------------------------------

    async def recall(self, *, namespace: str, query: str, limit: int,
                     tenant_id: str = "") -> list[MemoryRecord]:
        outcome = await self.engine.recall(
            tenant_id,
            namespace or self.bank,
            query,
            providers=self.providers(tenant_id),
            limit=limit or self.top_k,
            max_tokens=self.max_tokens,
            tags=self.tags,
            prefer_observations=self.prefer_observations,
        )
        records = []
        for item in outcome.results:
            records.append(
                MemoryRecord(
                    text=item.get("text") or "",
                    score=float((item.get("scores") or {}).get("final") or 0.0),
                    source="hindsight",
                    metadata={
                        "type": item.get("type"),
                        "document_id": item.get("document_id"),
                        "mentioned_at": item.get("mentioned_at"),
                        "tags": item.get("tags"),
                        "id": item.get("id"),
                    },
                )
            )
        return records

    async def remember(
        self,
        *,
        namespace: str,
        user_text: str,
        assistant_text: str,
        session_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        meta = metadata or {}
        tenant_id = str(meta.get("tenant_id") or "")
        if not (user_text.strip() or assistant_text.strip()):
            return
        content = f"User: {user_text.strip()}"
        if assistant_text.strip() and not _is_refusal(assistant_text):
            content = f"{content}\nAssistant: {assistant_text.strip()}"
        tags = ["source:ragflow", *self.tags]
        if self.retain_async:
            await self.engine.enqueue_retain(
                tenant_id,
                namespace or self.bank,
                content,
                document_id=str(meta.get("chat_id") or session_id or ""),
                tags=tags,
                metadata=meta,
                providers_factory=self.providers,
            )
            return
        await self.engine.retain(
            tenant_id,
            namespace or self.bank,
            content,
            document_id=str(meta.get("chat_id") or session_id or ""),
            tags=tags,
            metadata=meta,
            providers=self.providers(tenant_id),
        )
