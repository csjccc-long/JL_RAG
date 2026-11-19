"""Observation consolidation.

Raw facts accumulate; observations are the durable generalisations built from
them. This is Hindsight's background consolidation step
(engine/consolidation/consolidator.py) reduced to one batched LLM decision per
group of facts:

  create - a new observation no existing one covers
  update - an existing observation, rewritten to absorb the new facts
  delete - an existing observation the new facts contradict
  skip   - nothing worth recording

Every decision keeps the source fact ids, so an observation can always be
traced back to the sentences that produced it, and the facts it absorbed are
stamped consolidated_at rather than deleted.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

from memory.hindsight.fusion import as_date
from memory.hindsight.llm import Providers, parse_json_payload
from memory.hindsight.store import MemoryStore, Unit, new_id, utcnow

logger = logging.getLogger(__name__)

BATCH_SIZE = 8
MAX_BATCHES = 4
MAX_OBSERVATIONS = 24

CONSOLIDATION_SYSTEM = """You maintain a memory bank's observations.
An observation is a durable, general statement supported by several facts, e.g.
"User is training for a marathon in April 2026 and runs 4x per week".

You get EXISTING observations (with ids) and NEW facts. Decide, for each new
fact, whether it:
  - creates a new observation (action "create", no id),
  - extends/corrects an existing one (action "update", with its id),
  - contradicts and replaces one (action "delete", with its id),
  - adds nothing (action "skip").

Rules:
- Merge related facts; never emit one observation per fact if they share a topic.
- Do not invent details that are not in the facts.
- Keep each observation under 60 words and self-contained.
- source_fact_ids must list the fact ids the observation rests on.
- Output JSON only: {"observations":[{"action":"create","text":"...",
  "source_fact_ids":["f1","f2"]}]}"""


async def consolidate(
    store: MemoryStore,
    tenant_id: str,
    bank_id: str,
    providers: Providers,
    *,
    scope_tags: Sequence[str] = (),
    max_batches: int = MAX_BATCHES,
    dry_run: bool = False,
) -> dict[str, Any]:
    pending = _pending_facts(store, tenant_id, bank_id, scope_tags)
    if not pending:
        return {"planned": [], "created": 0, "updated": 0, "deleted": 0, "skipped": 0, "facts": 0}
    existing = store.units(tenant_id, bank_id, kind="observation", limit=MAX_OBSERVATIONS)
    plans: list[dict[str, Any]] = []
    created = updated = deleted = skipped = 0
    processed = 0
    for batch in _chunks(pending, BATCH_SIZE * 2):
        if processed >= max_batches * BATCH_SIZE * 2:
            break
        decisions = await _decide(providers, batch, existing)
        processed += len(batch)
        for decision in decisions:
            action = decision.get("action")
            if action == "create":
                plans.append(decision)
                if not dry_run:
                    _apply_create(store, tenant_id, bank_id, decision, batch)
                    created += 1
            elif action in ("update", "delete"):
                plans.append(decision)
                if not dry_run:
                    if action == "update":
                        _apply_update(store, decision, batch)
                        updated += 1
                    else:
                        _apply_delete(store, tenant_id, bank_id, decision, batch)
                        deleted += 1
            else:
                skipped += 1
        if not dry_run:
            _stamp_consolidated(store, batch)
    if not dry_run and (created or updated or deleted):
        store.audit(tenant_id, bank_id, "consolidate",
                    {"created": created, "updated": updated, "deleted": deleted, "facts": processed})
    return {
        "planned": plans if dry_run else [],
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "skipped": skipped,
        "facts": processed,
    }


def _pending_facts(store: MemoryStore, tenant_id: str, bank_id: str,
                   scope_tags: Sequence[str]) -> list[Unit]:
    facts = store.units(tenant_id, bank_id, kind="fact", include_consolidated=False)
    wanted = {tag for tag in scope_tags if tag}
    if wanted:
        facts = [fact for fact in facts if wanted & set(fact.tags)]
    return facts


def _chunks(items: list[Unit], size: int):
    for index in range(0, len(items), size):
        yield items[index:index + size]


async def _decide(providers: Providers, batch: list[Unit], existing: list[Unit]) -> list[dict[str, Any]]:
    facts_block = "\n".join(
        f"[{fact.id}] {fact.text}" + (f" (tags: {', '.join(fact.tags)})" if fact.tags else "")
        for fact in batch
    )
    obs_block = "\n".join(f"[{obs.id}] {obs.text}" for obs in existing) or "(none)"
    user = f"EXISTING observations:\n{obs_block}\n\nNEW facts:\n{facts_block}"
    try:
        raw = await providers.chat(CONSOLIDATION_SYSTEM, user, max_tokens=1200)
    except Exception as exc:  # noqa: BLE001 - consolidation is background, never fatal
        logger.warning("hindsight consolidate: model unavailable (%s)", exc)
        return []
    payload = parse_json_payload(raw)
    if isinstance(payload, dict):
        decisions = payload.get("observations") or payload.get("results") or []
    elif isinstance(payload, list):
        decisions = payload
    else:
        decisions = []
    valid = {fact.id for fact in batch}
    out: list[dict[str, Any]] = []
    for item in decisions:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "create").lower()
        text = str(item.get("text") or "").strip()
        source = [str(sid) for sid in (item.get("source_fact_ids") or []) if str(sid) in valid]
        if action == "create" and text:
            out.append({"action": "create", "text": text, "source_fact_ids": source})
        elif action in ("update", "delete") and item.get("id"):
            out.append({"action": action, "id": str(item["id"]), "text": text, "source_fact_ids": source})
        else:
            out.append({"action": "skip"})
    return out


def _apply_create(store: MemoryStore, tenant_id: str, bank_id: str,
                  decision: dict[str, Any], batch: list[Unit]) -> None:
    sources = decision.get("source_fact_ids") or [fact.id for fact in batch]
    tags = sorted({tag for fact in batch if fact.id in sources for tag in fact.tags})
    unit = Unit(
        id=new_id("ob_"),
        tenant_id=tenant_id,
        bank_id=bank_id,
        text=decision["text"],
        kind="observation",
        fact_type="world",
        tags=tags,
        source_fact_ids=sources,
        proof_count=max(1, len(sources)),
        mentioned_at=utcnow(),
        created_at=utcnow(),
    )
    store.insert_unit(unit, _tokens(unit.text), None)


def _apply_update(store: MemoryStore, decision: dict[str, Any], batch: list[Unit]) -> None:
    updates: dict[str, Any] = {"source_fact_ids_json": _dump_ids(decision, batch)}
    if decision.get("text"):
        updates["text"] = decision["text"]
    store.update_unit(
        decision["id"],
        **updates,
        proof_count=max(1, len(decision.get("source_fact_ids") or batch)),
        mentioned_at=utcnow(),
    )


def _apply_delete(store: MemoryStore, tenant_id: str, bank_id: str,
                  decision: dict[str, Any], batch: list[Unit]) -> None:
    store.update_unit(decision["id"], superseded_by=new_id("ob_"))
    store.audit(tenant_id, bank_id, "observation.delete", {"id": decision["id"]})


def _stamp_consolidated(store: MemoryStore, batch: list[Unit]) -> None:
    now = utcnow()
    for fact in batch:
        store.update_unit(fact.id, consolidated_at=now)


def _dump_ids(decision: dict[str, Any], batch: list[Unit]) -> str:
    import json

    ids = decision.get("source_fact_ids") or [fact.id for fact in batch]
    return json.dumps(ids, ensure_ascii=False)


def _tokens(text: str) -> str:
    from memory.hindsight.tokens import tokenize

    return tokenize(text)


MAX_EVIDENCE = 8


def observation_tree(store: MemoryStore, tenant_id: str, bank_id: str) -> dict[str, Any]:
    """Observations grouped by their first tag, with the facts that support each one.

    The evidence is inlined so the console can show a traceable chain without a
    request per observation. A fact is only included when it still belongs to the
    same tenant and bank, so a copied observation cannot leak another bank's text.
    """
    observations = store.units(tenant_id, bank_id, kind="observation")
    facts = {unit.id: unit for unit in store.units(tenant_id, bank_id, kind="fact")}
    groups: dict[str, list[dict[str, Any]]] = {}
    for obs in observations:
        evidence = []
        for fact_id in obs.source_fact_ids[:MAX_EVIDENCE]:
            fact = facts.get(fact_id)
            if fact is None or fact.superseded_by:
                continue
            evidence.append({
                "id": fact.id,
                "text": fact.text,
                "type": fact.fact_type,
                "document_id": fact.document_id,
                "mentioned_at": fact.mentioned_at,
                "tags": fact.tags,
            })
        key = obs.tags[0] if obs.tags else "general"
        groups.setdefault(key, []).append({
            "id": obs.id,
            "text": obs.text,
            "proof_count": obs.proof_count,
            "source_fact_ids": obs.source_fact_ids,
            "evidence": evidence,
            "tags": obs.tags,
            "mentioned_at": obs.mentioned_at,
        })
    return {"groups": [{"scope": scope, "observations": items} for scope, items in groups.items()],
            "total": len(observations)}


def observation_scopes(store: MemoryStore, tenant_id: str, bank_id: str) -> list[dict[str, Any]]:
    observations = store.units(tenant_id, bank_id, kind="observation")
    counts: dict[str, int] = {}
    for obs in observations:
        key = obs.tags[0] if obs.tags else "general"
        counts[key] = counts.get(key, 0) + 1
    return [{"scope": scope, "count": count} for scope, count in sorted(counts.items())]


def clear_observations(store: MemoryStore, tenant_id: str, bank_id: str, *, scope: str = "",
                       forget: Callable[[Sequence[str]], int] | None = None) -> int:
    observations = store.units(tenant_id, bank_id, kind="observation")
    removed_ids: list[str] = []
    for obs in observations:
        if scope and scope not in obs.tags:
            continue
        store.delete_unit(obs.id)
        removed_ids.append(obs.id)
    # The rows are gone but their vectors are not: whoever owns the vector
    # index passes forget() so the index follows the delete, exactly as the
    # engine does for a single memory, a document, or a pruned bank.
    if forget is not None and removed_ids:
        forget(removed_ids)
    store.audit(tenant_id, bank_id, "observations.clear",
                {"scope": scope, "removed": len(removed_ids)})
    return len(removed_ids)


def fresh_observations(store: MemoryStore, tenant_id: str, bank_id: str, *, days: int = 30) -> list[Unit]:
    """Observations mentioned within the last few days (undated ones count as fresh)."""
    today = datetime.now(timezone.utc).date()
    fresh = []
    for obs in store.units(tenant_id, bank_id, kind="observation"):
        stamp = as_date(obs.mentioned_at)
        if stamp is None or (today - stamp).days <= days:
            fresh.append(obs)
    return fresh
