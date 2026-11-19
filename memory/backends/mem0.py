"""Chat-mode memory backend: self-hosted Mem0 over its REST API.

Mem0 runs as its own service (`mem0/server`, backed by Qdrant or pgvector) and
extracts durable facts from conversation turns. RAGFlow only speaks HTTP to it:
recall before the completion, and `add` the finished turn afterwards.

The backend must never break a chat: when Mem0 is not configured or not
reachable, recall returns no memories and remember logs once and gives up.
"""

from __future__ import annotations

import logging
from typing import Any

from memory.backends.base import MemoryRecord, clip

DEFAULT_TIMEOUT_SECONDS = 6.0
MEMORY_TEXT_CHARS = 320
REMEMBER_USER_CHARS = 1200
REMEMBER_ASSISTANT_CHARS = 2000


def _extract_items(payload: Any) -> list[dict]:
    """Normalise the shapes Mem0 server returns across versions."""
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("results", "memories", "data"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _item_text(item: dict) -> str:
    for key in ("memory", "text", "data", "content"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


class Mem0MemoryBackend:
    """Thin async client for a self-hosted Mem0 server."""

    name = "mem0"

    def __init__(
        self,
        base_url: str = "",
        api_key: str = "",
        *,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        top_k: int = 5,
        infer: bool = True,
        http_client: Any = None,
        client_factory: Any = None,
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key or ""
        self.timeout = timeout
        self.top_k = top_k
        self.infer = infer
        self._client = http_client
        self._client_factory = client_factory
        self._warned = False

    # -- plumbing -------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return bool(self.base_url or self._client is not None or self._client_factory is not None)

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    def _get_client(self):
        if self._client is not None:
            return self._client
        if self._client_factory is not None:
            self._client = self._client_factory(self.base_url, self._headers(), self.timeout)
            return self._client
        if not self.base_url:
            return None
        # Imported lazily so the memory package stays importable in contexts
        # (unit tests, CLI helpers) where the HTTP stack is not installed.
        import httpx

        # Mem0 is normally an internal sidecar: ignore HTTP(S)_PROXY from the
        # environment so a corporate proxy cannot intercept localhost calls.
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=self._headers(),
            timeout=self.timeout,
            trust_env=False,
        )
        return self._client

    def _warn_once(self, message: str) -> None:
        if not self._warned:
            logging.warning(message)
            self._warned = True

    async def aclose(self) -> None:
        client = self._client
        self._client = None
        closer = getattr(client, "aclose", None)
        if closer is None:
            return
        try:
            await closer()
        except Exception:  # noqa: BLE001 - closing must not raise
            pass

    # -- recall ---------------------------------------------------------

    async def recall(self, *, namespace: str, query: str, limit: int,
                     tenant_id: str = "") -> list[MemoryRecord]:
        if not query or limit <= 0:
            return []
        client = self._get_client()
        if client is None:
            self._warn_once("memory: Mem0 base_url is not configured; chat memory disabled.")
            return []
        body = {
            "query": query,
            "user_id": namespace,
            "limit": max(limit, self.top_k),
        }
        try:
            response = await client.post("/memories/search", json=body)
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # noqa: BLE001 - Mem0 failures degrade to no memory
            self._warn_once(f"memory: Mem0 recall failed ({exc!r}); continuing without chat memory.")
            return []

        records: list[MemoryRecord] = []
        for item in _extract_items(payload):
            text = _item_text(item)
            if not text:
                continue
            try:
                score = float(item.get("score") or 0.0)
            except (TypeError, ValueError):
                score = 0.0
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            records.append(
                MemoryRecord(
                    text=clip(text, MEMORY_TEXT_CHARS),
                    score=score,
                    source=str(item.get("id") or "mem0"),
                    metadata=dict(metadata),
                )
            )
        records.sort(key=lambda record: record.score, reverse=True)
        return records[:limit]

    # -- remember -------------------------------------------------------

    async def remember(
        self,
        *,
        namespace: str,
        user_text: str,
        assistant_text: str,
        session_id: str = "",
        metadata: dict | None = None,
    ) -> None:
        if not (user_text or "").strip() or not (assistant_text or "").strip():
            return
        client = self._get_client()
        if client is None:
            return
        body = {
            "messages": [
                {"role": "user", "content": clip(user_text, REMEMBER_USER_CHARS)},
                {"role": "assistant", "content": clip(assistant_text, REMEMBER_ASSISTANT_CHARS)},
            ],
            "user_id": namespace,
            "infer": self.infer,
            "metadata": dict(metadata or {}),
        }
        if session_id:
            body["run_id"] = session_id
        try:
            response = await client.post("/memories", json=body)
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001 - a failed write must not surface to the user
            logging.warning("memory: Mem0 add failed (%r); turn not persisted.", exc)
