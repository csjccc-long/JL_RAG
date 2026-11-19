"""Turn raw conversation into structured facts.

The prompt and the fact schema follow Hindsight's retain stage
(E:/hindsight/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py):
a fact is a five-slot record - what, when, where, who, why - plus a type, an
optional event span, entities and causal links to earlier facts in the batch.

A missing model must never mean a lost memory, so when the LLM is unavailable
or answers with garbage the heuristic splitter still produces storable facts.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Iterable

from memory.hindsight.llm import Providers, parse_json_payload

logger = logging.getLogger(__name__)

MAX_FACTS = 12
# CJK carries more meaning per character than Latin text, so a short sentence
# such as "用户名是 chen。" is already a complete fact.
MIN_FACT_CHARS = 8
MAX_FACT_CHARS = 400

_SENTENCE = re.compile(r"[^。！？!?\n]+[。！？!?]?")
_FILLER = (
    "好的", "收到", "谢谢", "不客气", "明白了", "ok", "okay", "thanks", "thank you",
    "你好", "hi", "hello", "再见", "bye",
)

EXTRACTION_SYSTEM = """You extract long-term memory facts from a conversation.
Return ONE JSON object: {"facts": [...]}.

Each fact object has exactly these keys:
  what       - one self-contained sentence. Resolve pronouns and references
               ("my roommate" + the name Emily -> "Emily (user's roommate)").
  when       - when it happened, as text. Convert relative time ("last Friday",
               "yesterday") to an absolute date using the conversation date.
  where      - place or context, or "" when unknown.
  who        - the people involved, including "user" for the user.
  why        - the reason or motivation, or "" when none is stated.
  fact_type  - "world" for facts about the world/user, "assistant" for facts
               about the assistant's own behaviour or preferences.
  fact_kind  - "event" for something that happened, "conversation" otherwise.
  occurred_start, occurred_end - ISO dates (YYYY-MM-DD) for events, else null.
               A coarse period ("in 2015") expands to its whole span.
  entities   - array of plain strings (people, places, organisations, products).
               Never objects. Trim to the names only.
  caused_by  - array of indices into this same facts array that caused this
               fact, or []. A cause must appear BEFORE the effect.

Rules:
- Keep only facts worth remembering in a later conversation. Skip greetings,
  filler, process talk ("let me check"), restating the question, and anything
  that is only true for this single turn.
- Never record that the assistant did not know, could not find, refused or
  apologised. "Not found in the knowledge base" is an empty answer, not a fact.
- Prefer what the user asserted; the assistant's answer only matters when it
  adds a decision, a value or an outcome.
- Do not invent. If a slot is unknown, use "" or null.
- Do not store credentials, API keys, passwords or identity numbers.
- At most %d facts. Prefer fewer, better facts.
Return JSON only, no commentary.""" % MAX_FACTS


@dataclass
class ExtractedFact:
    what: str
    when: str = ""
    where: str = ""
    who: str = ""
    why: str = ""
    fact_type: str = "world"
    fact_kind: str = "conversation"
    occurred_start: str | None = None
    occurred_end: str | None = None
    entities: list[str] = field(default_factory=list)
    caused_by: list[int] = field(default_factory=list)

    @property
    def text(self) -> str:
        """The fact as one sentence.

        The other slots are not glued onto it: a trailing "| user" would end
        up in the embedding, the BM25 index and the injected prompt, and would
        match unrelated queries. They live in the context property instead.
        """
        return self.what.strip()

    @property
    def context(self) -> str:
        parts = []
        for label, value in (
            ("when", self.when),
            ("where", self.where),
            ("who", self.who),
            ("why", self.why),
        ):
            if value and value.strip():
                parts.append(f"{label}: {value.strip()}")
        return " | ".join(parts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "what": self.what,
            "when": self.when,
            "where": self.where,
            "who": self.who,
            "why": self.why,
            "fact_type": self.fact_type,
            "fact_kind": self.fact_kind,
            "occurred_start": self.occurred_start,
            "occurred_end": self.occurred_end,
            "entities": list(self.entities),
            "caused_by": list(self.caused_by),
            "text": self.text,
            "context": self.context,
        }


async def extract_facts(
    providers: Providers,
    text: str,
    *,
    context: str = "",
    today: date | None = None,
    max_facts: int = MAX_FACTS,
    mission: str = "",
) -> list[ExtractedFact]:
    """Ask the model for facts; fall back to sentence splitting on any failure."""
    body = (text or "").strip()
    if not body:
        return []
    stamp = (today or datetime.now().date()).isoformat()
    system = EXTRACTION_SYSTEM
    if mission:
        system += f"\nBank mission (what matters here): {mission}"
    user = f"Conversation date: {stamp}\n"
    if context:
        user += f"Context: {context}\n"
    user += f"Conversation:\n{body}"
    try:
        raw = await providers.chat(system, user, max_tokens=1600)
    except Exception as exc:  # noqa: BLE001 - a provider outage must not lose the turn
        logger.warning("hindsight extract: model unavailable (%s), using heuristic", exc)
        return heuristic_facts(body, max_facts=max_facts)
    facts = parse_facts(raw, max_facts=max_facts)
    return facts or heuristic_facts(body, max_facts=max_facts)


def parse_facts(raw: str, *, max_facts: int = MAX_FACTS) -> list[ExtractedFact]:
    payload = parse_json_payload(raw)
    if isinstance(payload, dict):
        items = payload.get("facts") or payload.get("memories") or []
    elif isinstance(payload, list):
        items = payload
    else:
        items = []
    facts: list[ExtractedFact] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        what = str(item.get("what") or item.get("text") or item.get("content") or "").strip()
        if not what:
            continue
        fact = ExtractedFact(
            what=what[:MAX_FACT_CHARS],
            when=str(item.get("when") or ""),
            where=str(item.get("where") or ""),
            who=str(item.get("who") or ""),
            why=str(item.get("why") or ""),
            fact_type="assistant" if str(item.get("fact_type")).lower() == "assistant" else "world",
            fact_kind="event" if str(item.get("fact_kind")).lower() == "event" else "conversation",
            occurred_start=normalize_date(item.get("occurred_start")),
            occurred_end=normalize_date(item.get("occurred_end")),
            entities=sanitize_entities(item.get("entities")),
            caused_by=[],
        )
        if fact.occurred_start and not fact.occurred_end:
            fact.occurred_end = fact.occurred_start
        facts.append(fact)
        if len(facts) >= max_facts:
            break
    for index, item in enumerate(items[: len(facts)]):
        if not isinstance(item, dict):
            continue
        relations = item.get("caused_by") or item.get("causal_relations") or []
        for relation in relations:
            target = None
            if isinstance(relation, int):
                target = relation
            elif isinstance(relation, dict):
                target = relation.get("target_index", relation.get("index"))
            try:
                target_index = int(target)
            except (TypeError, ValueError):
                continue
            if 0 <= target_index < index:
                facts[index].caused_by.append(target_index)
    return facts


def sanitize_entities(raw: Any) -> list[str]:
    if not isinstance(raw, (list, tuple)):
        return []
    names: list[str] = []
    for item in raw:
        if isinstance(item, str):
            name = item.strip()
        elif isinstance(item, dict):
            name = str(item.get("name") or item.get("text") or "").strip()
        else:
            name = ""
        if name and len(name) <= 80 and name not in names:
            names.append(name)
    return names[:20]


def normalize_date(value: Any) -> str | None:
    """Coerce a date-ish value to YYYY-MM-DD; return None when unusable."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("/", "-")
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if match:
        year, month, day = (int(part) for part in match.groups())
        try:
            return date(year, max(1, min(12, month)), max(1, min(28, day))).isoformat()
        except ValueError:
            return None
    match = re.match(r"^(\d{4})-(\d{1,2})$", text)
    if match:
        year, month = (int(part) for part in match.groups())
        return date(year, max(1, min(12, month)), 1).isoformat()
    match = re.match(r"^(\d{4})$", text)
    if match:
        return f"{int(match.group(1)):04d}-01-01"
    return None


def heuristic_facts(text: str, *, max_facts: int = MAX_FACTS) -> list[ExtractedFact]:
    """Fallback extraction: keep substantive sentences, drop pleasantries."""
    facts: list[ExtractedFact] = []
    seen: set[str] = set()
    for chunk in _SENTENCE.findall(text or ""):
        sentence = re.sub(r"\s+", " ", chunk).strip()
        lowered = sentence.lower()
        # The heuristic only trusts the user's own words: an assistant line is
        # either an acknowledgement ("好。") or an answer the user already asked
        # for, and storing it doubles the fact count for one exchange.
        if lowered.startswith("assistant:"):
            continue
        if lowered.startswith("user:"):
            sentence = sentence[5:].strip()
            lowered = sentence.lower()
        if len(sentence) < MIN_FACT_CHARS or len(sentence) > MAX_FACT_CHARS:
            continue
        if any(lowered.startswith(filler) or lowered == filler for filler in _FILLER):
            continue
        key = lowered.rstrip("。.!?！？")
        if key in seen:
            continue
        seen.add(key)
        facts.append(ExtractedFact(what=sentence, who="user", fact_kind="conversation"))
        if len(facts) >= max_facts:
            break
    return facts


def apply_defense(facts: Iterable[ExtractedFact], enabled: bool) -> list[ExtractedFact]:
    """Drop facts carrying secrets or identifiers when memory defence is on."""
    items = list(facts)
    if not enabled:
        return items
    return [fact for fact in items if not contains_secret(fact.text)]


_SECRET_PATTERNS = (
    re.compile(r"\b(sk|pk|ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9]{16,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b\d{16,19}\b"),
    re.compile(r"(?i)\b(password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*\S+"),
)


def contains_secret(text: str) -> bool:
    return any(pattern.search(text or "") for pattern in _SECRET_PATTERNS)
