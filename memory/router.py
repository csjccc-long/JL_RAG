"""Routes a chat turn to the right memory backend.

Work mode runs the native Hindsight engine (memory/hindsight/) in a bank of its
own, chat mode uses self-hosted Mem0, and `off` disables recall and write-back.
The existing RAGFlow memory library is not involved here: it keeps serving the
Memory page, agent Message components and the Retrieval tool as before.

Mode resolution order (first hit wins):

1. the request's explicit `memory_mode` field (a UI/command switch);
2. the chat assistant's `prompt_config.memory_mode` preset;
3. the configured default (`memory.default_mode`, `auto` out of the box);
4. `auto` infers from the assistant: every assistant gets chat memory.

Work is deliberately outside inference: every retain is an LLM extraction job,
so it can only be reached through an explicit switch (1 or 2) or an explicitly
configured default. Auto never turns it on.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from typing import Any

from memory.backends.base import MemoryBackend, MemoryRecord, build_prompt_block
from memory.backends.hindsight import HindsightBackend
from memory.backends.mem0 import Mem0MemoryBackend
from memory.config import (
    MODE_AUTO,
    MODE_CHAT,
    MODE_OFF,
    MODE_WORK,
    MemorySettings,
    normalize_mode,
)

# Keep references to fire-and-forget writes so the garbage collector does not
# cancel them mid-flight.
_BACKGROUND_TASKS: set[asyncio.Task] = set()

UNKNOWN_NAMESPACE = "anonymous"


def project_bank(project: str, prefix: str = "work") -> str:
    """Bank name for one project: <prefix>-<sha1(path)[:12]>."""
    digest = hashlib.sha1((project or "").encode("utf-8")).hexdigest()[:12]
    return f"{(prefix or 'work').strip() or 'work'}-{digest}"


def infer_mode(dialog: Any) -> str:
    """Auto picks the free backend: chat memory, whatever the assistant shape.

    Work never shows up here on purpose: it runs the Hindsight engine, which
    spends LLM tokens on every turn, so it only runs when someone selects it.
    """
    return MODE_CHAT


class MemoryRouter:
    """Dispatches recall/remember to the backend selected by the mode."""

    def __init__(
        self,
        settings: MemorySettings | None = None,
        *,
        mem0: MemoryBackend | None = None,
        hindsight: MemoryBackend | None = None,
    ):
        self.settings = settings or MemorySettings.load()
        self._mem0 = mem0 or Mem0MemoryBackend(
            self.settings.mem0.base_url,
            self.settings.mem0.api_key,
            timeout=self.settings.mem0.timeout,
            top_k=self.settings.mem0.top_k,
            infer=self.settings.mem0.infer,
        )
        self._hindsight = hindsight or HindsightBackend(self.settings.hindsight)

    # -- selection ------------------------------------------------------

    def backend_for(self, mode: str) -> MemoryBackend | None:
        if mode == MODE_WORK:
            return self._hindsight
        if mode == MODE_CHAT:
            return self._mem0
        return None

    @property
    def hindsight(self) -> HindsightBackend:
        """The Hindsight engine, shared with the management API and work mode."""
        return self._hindsight  # type: ignore[return-value]

    def resolve_mode(self, *, explicit: Any = "", dialog: Any = None) -> str:
        prompt_config = getattr(dialog, "prompt_config", None) or {}

        for candidate in (explicit, prompt_config.get("memory_mode"), self.settings.default_mode):
            mode = normalize_mode(candidate)
            if mode and mode != MODE_AUTO:
                return mode
        if dialog is None:
            return MODE_OFF
        return infer_mode(dialog)

    def namespace_for(self, *, mode: str, dialog: Any = None, user_id: str = "") -> str:
        prompt_config = getattr(dialog, "prompt_config", None) or {}
        if mode == MODE_WORK:
            # One bank per project. The path is hashed rather than stored so the
            # name is short and two repositories never read each other's memory.
            project = (
                str(prompt_config.get("memory_project") or "").strip()
                or self.settings.hindsight.project
                or os.getcwd()
            )
            return project_bank(project, self.settings.hindsight.bank_prefix)
        if mode == MODE_CHAT:
            return str(user_id or prompt_config.get("memory_user") or UNKNOWN_NAMESPACE).strip() or UNKNOWN_NAMESPACE
        return ""

    # -- recall ---------------------------------------------------------

    async def recall(self, *, mode: str, namespace: str, query: str,
                     tenant_id: str = "") -> list[MemoryRecord]:
        backend = self.backend_for(mode)
        if backend is None or not query:
            return []
        try:
            return await backend.recall(
                namespace=namespace, query=query, limit=self.settings.recall_limit, tenant_id=tenant_id
            )
        except Exception as exc:  # noqa: BLE001 - memory is decoration, never a hard dependency
            logging.warning("memory: %s recall failed (%r); continuing without it.", mode, exc)
            return []

    async def context_block(self, *, mode: str, namespace: str, query: str,
                            tenant_id: str = "") -> str:
        if mode in (MODE_OFF, "", None):
            return ""
        records = await self.recall(mode=mode, namespace=namespace, query=query, tenant_id=tenant_id)
        return build_prompt_block(records, char_limit=self.settings.prompt_chars)

    # -- write-back -----------------------------------------------------

    def remember(
        self,
        *,
        mode: str,
        namespace: str,
        user_text: str,
        assistant_text: str,
        session_id: str = "",
        metadata: dict | None = None,
    ) -> None:
        backend = self.backend_for(mode)
        if backend is None:
            return
        task = asyncio.create_task(
            self._remember_safely(
                backend,
                namespace=namespace,
                user_text=user_text,
                assistant_text=assistant_text,
                session_id=session_id,
                metadata=metadata,
            )
        )
        _BACKGROUND_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_TASKS.discard)

    async def _remember_safely(self, backend: MemoryBackend, **kwargs) -> None:
        try:
            await backend.remember(**kwargs)
        except Exception as exc:  # noqa: BLE001
            logging.warning("memory: %s write failed (%r); turn not persisted.", backend.name, exc)

    async def drain(self, timeout: float | None = None) -> None:  # noqa: ASYNC109 - plain wait budget, not a cancellation
        """Await pending writes. Used by tests and graceful shutdown."""
        pending = [task for task in _BACKGROUND_TASKS if not task.done()]
        if not pending:
            return
        await asyncio.wait(pending, timeout=timeout)


_ROUTER: MemoryRouter | None = None


def get_memory_router() -> MemoryRouter:
    global _ROUTER
    if _ROUTER is None:
        _ROUTER = MemoryRouter()
    return _ROUTER


def set_memory_router(router: MemoryRouter | None) -> None:
    """Install a router (tests) or reset the process singleton with None."""
    global _ROUTER
    _ROUTER = router


def reset_memory_router() -> None:
    set_memory_router(None)
