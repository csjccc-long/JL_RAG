"""Bounded reflect loop over the memory bank.

Mirrors Hindsight's reflect agent (engine/reflect/agent.py): the model may
search a few times, must answer in a fixed shape, and is finally synthesised
from the evidence gathered even if it never stops searching. Reflection is the
expensive path, so the loop is deliberately short and every step is capped.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence

from memory.hindsight.llm import Providers, parse_json_payload
from memory.hindsight.recall import RecallQuery, recall
from memory.hindsight.store import MemoryStore

logger = logging.getLogger(__name__)

MAX_STEPS = 6
FACTS_PER_SEARCH = 6

REFLECT_SYSTEM = """You answer a question from a memory bank.
You may search the bank, then answer.

Reply with ONE JSON object:
  {"action":"search","query":"..."}      to look something up, or
  {"action":"answer","answer":"...","citations":["id1","id2"]}

Rules:
- Search before answering unless the question needs no evidence at all.
- Base the answer only on what the search returned; say so plainly when the
  bank does not contain the answer instead of guessing.
- citations must be ids of the memories you used, not sentences.
- Keep the answer under 150 words.

Bank directives (obey them):
%s"""


async def reflect(
    store: MemoryStore,
    tenant_id: str,
    bank_id: str,
    providers: Providers,
    *,
    query: str,
    limit: int = FACTS_PER_SEARCH,
    max_tokens: int = 1200,
    max_steps: int = MAX_STEPS,
    directives: Sequence[str] = (),
    mental_models: Sequence[str] = (),
    tags: Sequence[str] = (),
) -> dict[str, Any]:
    question = (query or "").strip()
    if not question:
        return {"answer": "", "citations": [], "facts": [], "steps": 0}
    directive_text = "\n".join(f"- {item}" for item in directives) or "- (none)"
    system = REFLECT_SYSTEM % directive_text
    if mental_models:
        system += "\n\nBank mental models (background, may be stale):\n" + "\n".join(
            f"- {text}" for text in mental_models
        )
    transcript: list[str] = [f"Question: {question}"]
    collected: dict[str, dict[str, Any]] = {}
    steps = 0
    for step in range(max_steps):
        steps = step + 1
        prompt = "\n\n".join(transcript)
        if collected:
            prompt += "\n\nEvidence so far:\n" + _evidence_block(collected)
        try:
            raw = await providers.chat(system, prompt, max_tokens=max_tokens)
        except Exception as exc:  # noqa: BLE001 - reflection must not break the caller
            logger.warning("hindsight reflect: model unavailable (%s)", exc)
            break
        payload = parse_json_payload(raw)
        action = str((payload or {}).get("action") or "").lower() if isinstance(payload, dict) else ""
        if action == "search":
            search_query = str(payload.get("query") or question)
            outcome = await recall(
                store, tenant_id, bank_id,
                RecallQuery(query=search_query, max_tokens=600, limit=limit, tags=tags),
                providers=providers,
            )
            new_ids = []
            for item in outcome.results:
                if item["id"] not in collected:
                    new_ids.append(item["id"])
                collected[item["id"]] = item
            transcript.append(f"Searched: {search_query} -> {len(new_ids)} new memories")
            continue
        if action == "answer":
            answer = str(payload.get("answer") or "").strip()
            citations = [str(cid) for cid in (payload.get("citations") or []) if str(cid) in collected]
            if answer:
                return {
                    "answer": answer,
                    "citations": citations,
                    "facts": list(collected.values()),
                    "steps": steps,
                }
            transcript.append("Answer was empty; search again or restate.")
            continue
        text = (raw or "").strip()
        if text:
            return {"answer": text, "citations": [], "facts": list(collected.values()), "steps": steps}
        transcript.append("Reply was not valid JSON; use the search or answer action.")
    synthesis = await _forced_synthesis(providers, question, collected, directives)
    return {
        "answer": synthesis,
        "citations": list(collected.keys()),
        "facts": list(collected.values()),
        "steps": steps,
        "forced": True,
    }


def _evidence_block(collected: dict[str, dict[str, Any]]) -> str:
    return "\n".join(f"[{item_id}] {item.get('text', '')}" for item_id, item in collected.items())


async def _forced_synthesis(providers: Providers, question: str,
                            collected: dict[str, dict[str, Any]],
                            directives: Sequence[str]) -> str:
    evidence = _evidence_block(collected) or "(no memories were found)"
    system = (
        "Answer the question using only the evidence below. If the evidence does "
        "not contain the answer, say that the memory bank has nothing on it."
    )
    if directives:
        system += "\nDirectives:\n" + "\n".join(f"- {item}" for item in directives)
    user = f"Question: {question}\n\nEvidence:\n{evidence}"
    try:
        return (await providers.chat(system, user, max_tokens=800)).strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("hindsight reflect: synthesis failed (%s)", exc)
        return ""
