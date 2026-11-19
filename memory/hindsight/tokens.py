"""Token counting with a dependency-free fallback.

The budget packing in memory.hindsight.recall needs a token estimate
that is stable across deployments. RAGFlow's own counter is used when it imports
(tiktoken-backed, model aware); otherwise a character-class heuristic keeps the
engine usable in unit tests and in processes that do not ship the API extras.
"""

from __future__ import annotations

import re

_CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")
_WORD = re.compile(r"[A-Za-z0-9_]+")
_counter = None
_probed = False


def _ragflow_counter():
    global _counter, _probed
    if _probed:
        return _counter
    _probed = True
    try:  # pragma: no cover - depends on the API extras being importable
        from common.token_utils import num_tokens_from_string

        _counter = num_tokens_from_string
    except Exception:  # noqa: BLE001 - memory must work outside the API process
        _counter = None
    return _counter


def count_tokens(text: str) -> int:
    """Best-effort token count for a single memory text."""
    if not text:
        return 0
    counter = _ragflow_counter()
    if counter is not None:
        try:
            return max(1, int(counter(text)))
        except Exception:  # noqa: BLE001
            pass
    cjk = len(_CJK.findall(text))
    words = len(_WORD.findall(text))
    return max(1, cjk + (words + 3) // 4 + len(text) // 400)


_CJK_RUN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+")


def _terms(text: str) -> list[str]:
    terms: list[str] = []
    for match in _CJK_RUN.finditer(text or ""):
        run = match.group(0)
        if len(run) == 1:
            terms.append(run)
            continue
        terms.extend(run[index:index + 2] for index in range(len(run) - 1))
        if len(run) <= 6:
            terms.append(run)
    for word in _WORD.findall(text or ""):
        lowered = word.lower()
        if len(lowered) > 1 or lowered.isdigit():
            terms.append(lowered)
    return terms


def tokenize(text: str) -> str:
    """Index form: CJK bigrams plus lowercased latin words, space separated."""
    return " ".join(_terms(text))


def search_terms(text: str, *, max_terms: int = 16) -> list[str]:
    """Query form: the same tokenisation, de-duplicated, capped."""
    seen: dict[str, None] = {}
    for term in _terms(text):
        seen.setdefault(term, None)
        if len(seen) >= max_terms:
            break
    return list(seen)


def set_token_counter(fn) -> None:
    """Install an explicit counter (tests, or a caller with a better estimate)."""
    global _counter, _probed
    _counter = fn
    _probed = True
