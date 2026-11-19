"""Configuration for the pluggable memory modes.

Read from the `memory` section of conf/service_conf.yaml, with environment
variables as overrides so deployments can wire a backend without editing files:

    memory:
      default_mode: auto          # auto | work | chat | off
      prompt_chars: 900
      recall_limit: 5
      mem0:
        base_url: 'http://localhost:8888'
        api_key: ''
        top_k: 5
      hindsight:                  # the engine behind work mode
        db_path: '~/.ragflow/memory/hindsight.db'
        project: 'E:/work/repo'   # project path whose hash names the work bank
        bank_prefix: 'work'       # work bank is <prefix>-<sha1(project)[:12]>
        bank: 'ragflow'           # shared bank the console opens by default
        budget: mid               # low | mid | high
        max_tokens: 1600
        async: true               # retain is an LLM job; never block the answer
        defense: false            # drop facts with secrets/identifiers on write
        consolidate_after: 12     # facts per document before observations are built
        chunk_chars: 3000          # characters per stored chunk during retain

Work mode runs the native Hindsight engine (memory/hindsight/), so every retain
costs one LLM extraction call. That is why `auto` never infers it: the free
backend is Mem0 chat memory, and work has to be switched on explicitly per
assistant or per conversation (the UI memory switch).

When nothing is configured the router still works: chat stays disabled until
Mem0 gets a base_url, and work falls back to `~/.ragflow/memory/hindsight.db`
with a bank hashed from the server cwd, using the tenant's own models.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping


MODE_AUTO = "auto"
MODE_WORK = "work"
MODE_CHAT = "chat"
MODE_OFF = "off"
VALID_MODES = (MODE_AUTO, MODE_WORK, MODE_CHAT, MODE_OFF)

# Assistants saved before work mode moved to Hindsight still carry the old name.
LEGACY_MODE_ALIASES = {"hindsight": MODE_WORK}


def normalize_mode(value: Any) -> str:
    """Return a canonical mode name, or "" when the value carries no mode."""
    if not isinstance(value, str):
        return ""
    candidate = LEGACY_MODE_ALIASES.get(value.strip().lower(), value.strip().lower())
    return candidate if candidate in VALID_MODES else ""


DEFAULT_PROMPT_CHARS = 900
DEFAULT_RECALL_LIMIT = 5
DEFAULT_HINDSIGHT_MAX_TOKENS = 1600


@dataclass(frozen=True)
class Mem0Settings:
    base_url: str = ""
    api_key: str = ""
    timeout: float = 6.0
    top_k: int = DEFAULT_RECALL_LIMIT
    infer: bool = True


@dataclass(frozen=True)
class HindsightSettings:
    """Native engine location and behaviour.

    There is no server to point at any more: the port stores the memories in one
    SQLite file and calls the tenant's own models, so db_path is the only
    address this needs. Vectors are mirrored into the document store's vector
    database (vector_backend) and keep their SQLite copy as the fallback.

    Work mode lives in a bank of its own: `work-<sha1(project)[:12]>`, so two
    repositories never share project memory. `bank` is the shared bank the
    /hindsight console opens by default, not what a chat turn uses.
    """

    db_path: str = ""
    project: str = ""
    bank_prefix: str = "work"
    bank: str = "ragflow"
    budget: str = "mid"
    max_tokens: int = DEFAULT_HINDSIGHT_MAX_TOKENS
    top_k: int = DEFAULT_RECALL_LIMIT
    tags: tuple[str, ...] = ()
    retain_async: bool = True
    prefer_observations: bool = True
    defense: bool = False
    consolidate_after: int = 12
    chunk_chars: int = 3000
    # Vectors go to the document store's vector database when one is configured
    # ("auto"), and to the SQLite scan beside the units otherwise ("sqlite").
    vector_backend: str = "auto"
    vector_index_prefix: str = "hindsight"


@dataclass(frozen=True)
class MemorySettings:
    default_mode: str = MODE_AUTO
    prompt_chars: int = DEFAULT_PROMPT_CHARS
    recall_limit: int = DEFAULT_RECALL_LIMIT
    mem0: Mem0Settings = field(default_factory=Mem0Settings)
    hindsight: HindsightSettings = field(default_factory=HindsightSettings)

    @classmethod
    def load(cls, conf: Mapping[str, Any] | None = None, env: Mapping[str, str] | None = None) -> "MemorySettings":
        env = os.environ if env is None else env
        if conf is None:
            conf = _read_service_conf()
        conf = conf or {}
        mem0_conf = conf.get("mem0") or {}
        hindsight_conf = conf.get("hindsight") or {}

        default_mode = normalize_mode(env.get("MEMORY_MODE") or conf.get("default_mode") or "") or MODE_AUTO
        return cls(
            default_mode=default_mode,
            prompt_chars=_as_int(conf.get("prompt_chars"), DEFAULT_PROMPT_CHARS),
            recall_limit=_as_int(conf.get("recall_limit"), DEFAULT_RECALL_LIMIT),
            mem0=Mem0Settings(
                base_url=str(env.get("MEM0_BASE_URL") or mem0_conf.get("base_url") or "").strip(),
                api_key=str(env.get("MEM0_API_KEY") or mem0_conf.get("api_key") or "").strip(),
                timeout=_as_float(mem0_conf.get("timeout"), 6.0),
                top_k=_as_int(mem0_conf.get("top_k"), DEFAULT_RECALL_LIMIT),
                infer=bool(mem0_conf.get("infer", True)),
            ),
            hindsight=HindsightSettings(
                db_path=str(
                    env.get("HINDSIGHT_DB_PATH") or hindsight_conf.get("db_path") or _default_db_path()
                ).strip(),
                project=str(env.get("MEMORY_PROJECT") or hindsight_conf.get("project") or "").strip(),
                bank_prefix=(
                    str(env.get("HINDSIGHT_BANK_PREFIX") or hindsight_conf.get("bank_prefix") or "work").strip()
                    or "work"
                ),
                bank=str(env.get("HINDSIGHT_BANK") or hindsight_conf.get("bank") or "ragflow").strip() or "ragflow",
                budget=str(env.get("HINDSIGHT_BUDGET") or hindsight_conf.get("budget") or "mid").strip() or "mid",
                max_tokens=_as_int(
                    env.get("HINDSIGHT_MAX_TOKENS") or hindsight_conf.get("max_tokens"),
                    DEFAULT_HINDSIGHT_MAX_TOKENS,
                ),
                top_k=_as_int(hindsight_conf.get("top_k"), DEFAULT_RECALL_LIMIT),
                tags=_as_tags(hindsight_conf.get("tags")),
                retain_async=bool(hindsight_conf.get("async", True)),
                prefer_observations=bool(hindsight_conf.get("prefer_observations", True)),
                defense=bool(hindsight_conf.get("defense", False)),
                consolidate_after=_as_int(hindsight_conf.get("consolidate_after"), 12),
                chunk_chars=_as_int(
                    env.get("HINDSIGHT_CHUNK_CHARS") or hindsight_conf.get("chunk_chars"), 3000
                ),
                vector_backend=(
                    str(
                        env.get("HINDSIGHT_VECTOR_BACKEND")
                        or hindsight_conf.get("vector_backend")
                        or "auto"
                    ).strip().lower() or "auto"
                ),
                vector_index_prefix=(
                    str(
                        env.get("HINDSIGHT_VECTOR_INDEX_PREFIX")
                        or hindsight_conf.get("vector_index_prefix")
                        or "hindsight"
                    ).strip() or "hindsight"
                ),
            ),
        )


def _default_db_path() -> str:
    return str(Path.home() / ".ragflow" / "memory" / "hindsight.db")


def _as_tags(value: Any) -> tuple[str, ...]:
    if isinstance(value, str):
        return tuple(tag.strip() for tag in value.split(",") if tag.strip())
    if isinstance(value, (list, tuple)):
        return tuple(str(tag).strip() for tag in value if str(tag).strip())
    return ()


def _read_service_conf() -> dict:
    try:
        from common.config_utils import get_base_config
    except Exception:  # noqa: BLE001 - the router must import outside the API process too
        return {}
    try:
        return get_base_config("memory", {}) or {}
    except Exception as exc:  # noqa: BLE001
        import logging

        logging.warning("memory: cannot read the 'memory' service config (%r); using defaults.", exc)
        return {}


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default
