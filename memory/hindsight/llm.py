"""Model access for the native engine.

The engine never talks to a provider SDK directly. It asks a Providers object
for a completion or an embedding, which keeps the ported algorithms testable
with a stub and lets the RAGFlow backend supply the tenant's own models.

RagflowProviders resolves the tenant's default chat and embedding models through
the existing LLMBundle, so a memory write costs the same quota the user already
configured and no second set of API keys is needed.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Protocol

from memory.hindsight.tokens import count_tokens

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*|\s*```\s*$")


class Providers(Protocol):
    """What the engine needs from a model provider."""

    async def chat(self, system: str, user: str, *, max_tokens: int = 1200) -> str:
        ...

    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...

    async def rerank(self, query: str, docs: list[str]) -> list[float] | None:
        ...

    async def describe(self, image: bytes, prompt: str = "") -> str:
        ...


class NullProviders:
    """Stand-in used when no tenant/model is available (tests, CLI dry runs).

    chat raises so callers fall back to the heuristic extractor instead of
    silently storing nothing; embed returns no vectors so the semantic arm is
    simply absent while BM25 still works.
    """

    async def chat(self, system: str, user: str, *, max_tokens: int = 1200) -> str:
        raise RuntimeError("no chat model configured for native memory")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return []

    async def describe(self, image: bytes, prompt: str = "") -> str:
        raise RuntimeError("no vision model configured for native memory")


class RagflowProviders:
    """Tenant's default chat + embedding models, wrapped for the engine."""

    def __init__(self, tenant_id: str, *, chat_id: str = "", temperature: float = 0.1):
        self.tenant_id = tenant_id
        self.chat_id = chat_id
        self.temperature = temperature
        self._settings_ready = False
        self._chat = None
        self._embd = None
        self._rerank = None
        self._rerank_missing = False
        self._vision = None

    def _ensure_settings(self) -> None:
        """Make model resolution possible outside the API process.

        Resolving a tenant model goes through settings.FACTORY_LLM_INFOS, which
        is only filled by init_settings(). The web server calls it at startup,
        but a worker, a CLI probe or a test process has not, and then every
        lookup dies inside the factory table with a TypeError. Loading it here
        keeps the engine usable from any process.
        """
        if self._settings_ready:
            return
        from common import settings

        if getattr(settings, "FACTORY_LLM_INFOS", None) is None:
            settings.init_settings()
        self._settings_ready = True

    def _chat_bundle(self):
        if self._chat is None:
            self._ensure_settings()
            from api.db.services.llm_service import LLMBundle
            from api.db.joint_services.tenant_model_service import (
                get_tenant_default_model_by_type,
            )
            from common.constants import LLMType

            self._chat = LLMBundle(
                self.tenant_id, get_tenant_default_model_by_type(self.tenant_id, LLMType.CHAT)
            )
        return self._chat

    def _embd_bundle(self):
        if self._embd is None:
            self._ensure_settings()
            from api.db.services.llm_service import LLMBundle
            from api.db.joint_services.tenant_model_service import (
                get_tenant_default_model_by_type,
            )
            from common.constants import LLMType

            self._embd = LLMBundle(
                self.tenant_id, get_tenant_default_model_by_type(self.tenant_id, LLMType.EMBEDDING)
            )
        return self._embd

    def _rerank_bundle(self):
        if self._rerank is not None or self._rerank_missing:
            return self._rerank
        try:
            self._ensure_settings()
            from api.db.services.llm_service import LLMBundle
            from api.db.joint_services.tenant_model_service import (
                get_tenant_default_model_by_type,
            )
            from common.constants import LLMType

            model = get_tenant_default_model_by_type(self.tenant_id, LLMType.RERANK)
            self._rerank = LLMBundle(self.tenant_id, model)
        except Exception as exc:  # noqa: BLE001 - no reranker is a normal configuration
            logger.info("hindsight rerank: tenant has no rerank model (%s)", exc)
            self._rerank_missing = True
            self._rerank = None
        return self._rerank

    async def rerank(self, query: str, docs: list[str]) -> list[float] | None:
        if not docs:
            return []
        bundle = self._rerank_bundle()
        if bundle is None:
            return None
        import asyncio

        scores, _ = await asyncio.to_thread(bundle.similarity, query, list(docs))
        return [float(score) for score in scores]

    def _vision_bundle(self):
        if self._vision is None:
            self._ensure_settings()
            from api.db.services.llm_service import LLMBundle
            from api.db.joint_services.tenant_model_service import (
                get_tenant_default_model_by_type,
            )
            from common.constants import LLMType

            self._vision = LLMBundle(
                self.tenant_id, get_tenant_default_model_by_type(self.tenant_id, LLMType.VISION)
            )
        return self._vision

    async def describe(self, image: bytes, prompt: str = "") -> str:
        import asyncio

        bundle = self._vision_bundle()
        if prompt:
            text = await asyncio.to_thread(bundle.describe_with_prompt, image, prompt)
        else:
            text = await asyncio.to_thread(bundle.describe, image)
        return str(text or "")

    async def chat(self, system: str, user: str, *, max_tokens: int = 1200) -> str:
        bundle = self._chat_bundle()
        answer = await bundle.async_chat(
            system,
            [{"role": "user", "content": user}],
            {"temperature": self.temperature, "max_tokens": max_tokens},
        )
        if isinstance(answer, tuple):
            answer = answer[0]
        return str(answer or "")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        bundle = self._embd_bundle()
        vectors, _ = bundle.encode(texts)
        return [list(map(float, vec)) for vec in vectors]


def parse_json_payload(raw: str) -> Any:
    """Extract the first JSON object or array from a model reply.

    Models wrap JSON in prose or fences often enough that a bare json.loads is
    a bug waiting to happen; this tolerates both without accepting garbage.
    """
    text = (raw or "").strip()
    if not text:
        return None
    text = _FENCE.sub("", text).strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        if start < 0:
            continue
        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == opener:
                depth += 1
            elif char == closer:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:index + 1])
                    except ValueError:
                        break
    return None


def tokens(text: str) -> int:
    return count_tokens(text)
