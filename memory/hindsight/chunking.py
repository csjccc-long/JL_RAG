"""Retain chunking, ported from Hindsight's fact_extraction module.

Chunk boundaries are load-bearing in Hindsight: a chunk's index and content hash
are what delta retain matches against on a re-ingest, and what a stored fact
points back to through chunk_id. A chunker that drifted would make every
document look changed on every upload. So this is a faithful port of
hindsight_api/engine/retain/fact_extraction.py - the same separator ladder, the
same greedy packer, the same structured handling for JSON conversations and
JSONL - rather than a simplification of it.

Kept verbatim from the original:

* _RECURSIVE_TEXT_SEPARATORS - most- to least-preferred, ending in "" so a
  chunk can never exceed its budget.
* _iter_recursive_splits - the lazy equivalent of
  RecursiveCharacterTextSplitter._split_text with chunk_overlap=0,
  keep_separator=True and strip_whitespace=True.
* _iter_conversation_chunks / _iter_jsonl_chunks - whole turns and whole lines
  are packed before anything is split mid-record.
* sanitize_text / sanitize_value - strip characters that break UTF-8 encoding
  (control bytes, lone surrogates) before anything is hashed.

The result is idempotent: re-chunking any chunk returns it unchanged, which is
what keeps chunk_id stable across re-ingests.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Iterator
from typing import Any

# Hindsight's retain_chunk_size default ("Target maximum characters for each
# content chunk during retain", api/http.py).
CHUNK_CHARS = 3000

# Separators for sentence-aware recursive text splitting, ordered most- to
# least-preferred. The final "" lets the splitter break mid-word as a last
# resort so a chunk can never exceed the size budget.
_RECURSIVE_TEXT_SEPARATORS = [
    "\n\n",  # Paragraph breaks
    "\n",  # Line breaks
    ". ",  # Sentence endings
    "! ",  # Exclamations
    "? ",  # Questions
    "; ",  # Semicolons
    ", ",  # Commas
    " ",  # Words
    "",  # Characters (last resort)
]

# Control bytes (tab, newline and CR stay: they are valid in text and JSON) and
# lone UTF-16 surrogates, which cannot be encoded as UTF-8.
_UNSAFE_TEXT_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]")


def sanitize_text(text: str | None) -> str | None:
    """Drop characters that break downstream encoding, hashing or logging."""
    if not text:
        return text
    return _UNSAFE_TEXT_RE.sub("", text)


def sanitize_value(value: Any) -> Any:
    """sanitize_text applied recursively to every string in a value."""
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        cleaned = [sanitize_value(item) for item in value]
        return value if all(a is b for a, b in zip(cleaned, value)) else cleaned
    if isinstance(value, dict):
        cleaned_items = {sanitize_value(k): sanitize_value(v) for k, v in value.items()}
        if len(cleaned_items) == len(value) and all(value.get(k) is v for k, v in cleaned_items.items()):
            return value
        return cleaned_items
    return value


def _iter_separator_splits(text: str, separator: str) -> Iterator[str]:
    """Yield text cut at every occurrence of separator, separator kept on the right."""
    if not separator:
        yield from text
        return
    previous = 0
    for match in re.finditer(re.escape(separator), text):
        piece = text[previous:match.start()]
        if piece:
            yield piece
        previous = match.start()
    tail = text[previous:]
    if tail:
        yield tail


def _iter_recursive_splits(text: str, max_chars: int, separators: Iterable[str]) -> Iterator[str]:
    """Split text into chunks of at most max_chars, most-preferred separator first."""
    separators = list(separators)
    separator = separators[-1]
    remaining: list[str] = []
    for index, candidate in enumerate(separators):
        if not candidate:
            separator = candidate
            break
        if re.search(re.escape(candidate), text):
            separator = candidate
            remaining = separators[index + 1:]
            break

    buffered: list[str] = []
    buffered_len = 0

    def _flush() -> Iterator[str]:
        nonlocal buffered, buffered_len
        if buffered:
            packed = "".join(buffered).strip()
            buffered = []
            buffered_len = 0
            if packed:
                yield packed

    for piece in _iter_separator_splits(text, separator):
        if len(piece) < max_chars:
            if buffered and buffered_len + len(piece) > max_chars:
                yield from _flush()
            buffered.append(piece)
            buffered_len += len(piece)
            continue
        # Over budget even alone: close the run so ordering is preserved, then
        # split this piece further, or emit it whole when no separator is left.
        yield from _flush()
        if remaining:
            yield from _iter_recursive_splits(piece, max_chars, remaining)
        else:
            yield piece
    yield from _flush()


def _iter_conversation_chunks(turns: list[dict], max_chars: int, structured_limit: int) -> Iterator[str]:
    """Chunk a conversation array at turn boundaries, preserving complete turns."""
    current_chunk: list[dict] = []
    current_size = 2  # Account for "[]"
    emitted = False

    def _flush() -> Iterator[str]:
        nonlocal current_chunk, current_size, emitted
        if current_chunk:
            emitted = True
            yield json.dumps(current_chunk, ensure_ascii=False)
            current_chunk = []
            current_size = 2  # Reset to "[]"

    for turn in turns:
        turn_json = json.dumps(turn, ensure_ascii=False)
        turn_unit_size = len(turn_json)
        turn_size = turn_unit_size + 1  # +1 for comma

        # A turn too large to keep whole even alone: flush, then split it as text.
        if turn_unit_size > structured_limit:
            yield from _flush()
            for fragment in _iter_recursive_splits(
                turn_json, min(structured_limit, max_chars), _RECURSIVE_TEXT_SEPARATORS
            ):
                emitted = True
                yield fragment
            continue

        if current_size + turn_size > max_chars and current_chunk:
            yield from _flush()

        current_chunk.append(turn)
        current_size += turn_size

    yield from _flush()

    if not emitted:
        yield json.dumps(turns, ensure_ascii=False)


def _iter_nonblank_lines(text: str) -> Iterator[str]:
    """Yield text's non-blank lines without materialising them all."""
    start = 0
    length = len(text)
    while start < length:
        end = text.find("\n", start)
        if end == -1:
            end = length
        line = text[start:end]
        if line.endswith("\r"):
            line = line[:-1]
        if line and not line.isspace():
            yield line
        start = end + 1


def _looks_like_jsonl(text: str) -> bool:
    """Whether text is newline-delimited JSON: 2+ non-blank lines, each a JSON object."""
    seen = 0
    for line in _iter_nonblank_lines(text):
        try:
            parsed = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            return False
        if not isinstance(parsed, dict):
            return False
        seen += 1
    return seen >= 2


def _iter_jsonl_chunks(text: str, max_chars: int, structured_limit: int) -> Iterator[str]:
    """Chunk newline-delimited JSON (JSONL) at line boundaries."""
    current_chunk: list[str] = []
    current_size = 0

    def _flush() -> Iterator[str]:
        nonlocal current_chunk, current_size
        if current_chunk:
            yield "\n".join(current_chunk)
            current_chunk = []
            current_size = 0

    for line in _iter_nonblank_lines(text):
        line_unit_size = len(line)
        line_size = len(line) + 1  # +1 for the joining newline

        if line_unit_size > structured_limit:
            yield from _flush()
            yield from _iter_recursive_splits(
                line, min(structured_limit, max_chars), _RECURSIVE_TEXT_SEPARATORS
            )
            continue

        if current_size + line_size > max_chars and current_chunk:
            yield from _flush()

        current_chunk.append(line)
        current_size += line_size

    yield from _flush()


def iter_chunks(
    text: str,
    max_chars: int = CHUNK_CHARS,
    structured_chunk_size: int | None = None,
) -> Iterator[str]:
    """Stream the chunks of text, in order."""
    body = sanitize_text(text or "") or ""
    if not body:
        return
    if len(body) <= max_chars:
        yield body
        return

    structured_limit = structured_chunk_size if structured_chunk_size is not None else max_chars

    # json.loads turns a harmless ASCII "\ud83d" escape (half an emoji) into a
    # real lone surrogate; sanitize before it is re-serialized into a chunk.
    try:
        parsed = sanitize_value(json.loads(body))
    except (json.JSONDecodeError, ValueError):
        parsed = None

    if isinstance(parsed, list) and parsed and all(isinstance(turn, dict) for turn in parsed):
        yield from _iter_conversation_chunks(parsed, max_chars, structured_limit)
        return

    if isinstance(parsed, dict):
        # One structured unit: keep it whole up to the structured limit, else
        # split it as text within the chunk budget (idempotency, issue #2301).
        if len(body) <= structured_limit:
            yield body
        else:
            yield from _iter_recursive_splits(body, max_chars, _RECURSIVE_TEXT_SEPARATORS)
        return

    if _looks_like_jsonl(body):
        yield from _iter_jsonl_chunks(body, max_chars, structured_limit)
        return

    yield from _iter_recursive_splits(body, max_chars, _RECURSIVE_TEXT_SEPARATORS)


def chunk_text(
    text: str,
    max_chars: int = CHUNK_CHARS,
    structured_chunk_size: int | None = None,
) -> list[str]:
    """Split text into chunks, preserving conversation structure when present.

    Idempotent: re-chunking any chunk this returns yields that chunk unchanged.
    """
    return list(iter_chunks(text, max_chars, structured_chunk_size=structured_chunk_size))
