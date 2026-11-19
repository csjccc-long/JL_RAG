"""Shared contract for the pluggable memory backends.

Two backends coexist on purpose: the native Hindsight engine owns project work
memory, while self-hosted Mem0 owns conversational, per-user memory. The
existing RAGFlow memory store is untouched and keeps serving its own callers.

The router only needs two verbs, so the protocol stays this small. Recall must
never raise: a backend that is down degrades to "no memories" instead of
breaking the chat completion it is decorating.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

_LATIN_TOKEN = re.compile(r"[a-z0-9_]{2,}")
_CJK_RUN = re.compile(r"[\u4e00-\u9fff]+")

# A single recalled memory is clipped before it reaches the prompt; long entries
# otherwise crowd out the system prompt they are appended to.
RECORD_LINE_CHARS = 240


@dataclass(frozen=True)
class MemoryRecord:
    """One recalled memory, already scored by its backend."""

    text: str
    score: float = 0.0
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class MemoryBackend(Protocol):
    """Minimal surface the router multiplexes over."""

    name: str

    async def recall(self, *, namespace: str, query: str, limit: int,
                     tenant_id: str = "") -> list[MemoryRecord]: ...

    async def remember(
        self,
        *,
        namespace: str,
        user_text: str,
        assistant_text: str,
        session_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None: ...


def tokenize(text: str) -> set[str]:
    """Cheap lexical tokens that work for mixed Chinese/English text.

    Chinese has no whitespace delimiters here, so runs are expanded to character
    bigrams; that is enough for the overlap ranking recall needs and avoids
    pulling a segmenter into the API process.
    """
    lowered = (text or "").lower()
    tokens = set(_LATIN_TOKEN.findall(lowered))
    for run in _CJK_RUN.findall(lowered):
        if len(run) == 1:
            tokens.add(run)
        else:
            tokens.update(run[i : i + 2] for i in range(len(run) - 1))
    return tokens


def overlap_score(query_tokens: set[str], text: str) -> float:
    """Rank entries by query overlap, damped by entry length."""
    if not query_tokens:
        return 0.0
    entry_tokens = tokenize(text)
    if not entry_tokens:
        return 0.0
    hits = len(query_tokens & entry_tokens)
    if not hits:
        return 0.0
    return hits / math.sqrt(len(entry_tokens))


def clip(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def render_record_line(record: MemoryRecord) -> str:
    return "- " + clip(record.text, RECORD_LINE_CHARS)


def build_prompt_block(records: list[MemoryRecord], *, char_limit: int) -> str:
    """Render recalled memories as a system-prompt suffix.

    Returns an empty string when there is nothing worth injecting so callers can
    append unconditionally.
    """
    if not records or char_limit <= 0:
        return ""
    # English on purpose: the block is appended to prompts in any language, and
    # a Chinese header nudges English conversations into mixed-language replies.
    header = "## Memories (past records, for reference only; do not repeat them verbatim)"
    lines: list[str] = []
    used = len(header)
    for record in records:
        if not (record.text or "").strip():
            continue
        line = render_record_line(record)
        if used + len(line) + 1 > char_limit:
            break
        lines.append(line)
        used += len(line) + 1
    if not lines:
        return ""
    return header + "\n" + "\n".join(lines)
