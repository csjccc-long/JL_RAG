"""Four-arm recall: semantic, BM25, graph and temporal, fused with RRF.

Ported from Hindsight's recall pipeline (engine/search/*, engine/memories/pg/
recall.py). The arms are intentionally cheap and independent: each returns a
ranked id list, fusion decides, and only then does a per-result re-rank apply
recency, temporal and corroboration boosts. Nothing here calls a model except
the single query embedding.

The result is packed into a token budget rather than a fixed count, because the
caller injects these lines into a system prompt and the prompt is what actually
has a size limit.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Iterable, Sequence

from memory.hindsight.fusion import (
    as_date,
    bm25_like,
    cap_per_source,
    combined_score,
    cosine,
    fused_ranking,
    recency_signal,
    select_facts_within_budget,
    temporal_signal,
)
from memory.hindsight.llm import Providers
from memory.hindsight.store import MemoryStore, Unit
from memory.hindsight.rerank import RERANK_TOP, apply_rerank, cross_scores
from memory.hindsight.tokens import count_tokens, search_terms

logger = logging.getLogger(__name__)

PER_ARM = 40
BUDGET_FRACTIONS = {"low": 0.025, "mid": 0.075, "high": 0.25}
DEFAULT_MAX_TOKENS = 1200
MIN_BUDGET, MAX_BUDGET = 20, 2000
OBSERVATION_PREFERENCE = 0.75


@dataclass
class RecallQuery:
    query: str
    types: Sequence[str] = ()
    tags: Sequence[str] = ()
    tags_match: str = "any"
    temporal_window: dict[str, Any] | None = None
    query_timestamp: str | None = None
    budget: str | int = "mid"
    max_tokens: int | None = None
    limit: int = 10
    boost: str | None = None
    prefer_observations: bool = False
    per_arm: int = PER_ARM
    rerank: bool = True
    trace: bool = False


@dataclass
class RecallOutcome:
    results: list[dict[str, Any]] = field(default_factory=list)
    trace: dict[str, Any] = field(default_factory=dict)


async def recall(
    store: MemoryStore,
    tenant_id: str,
    bank_id: str,
    query: RecallQuery,
    *,
    providers: Providers | None = None,
    vector_index=None,
) -> RecallOutcome:
    units = store.units(tenant_id, bank_id)
    if not units:
        return RecallOutcome(results=[], trace={"reason": "empty bank"} if query.trace else {})
    by_id = {unit.id: unit for unit in units}
    candidates = [unit for unit in units if _keep(unit, query)]
    if not candidates:
        return RecallOutcome(results=[], trace={"reason": "filtered out"} if query.trace else {})

    window = _window(query.temporal_window)
    vectors = _bank_vectors(store, tenant_id, bank_id, vector_index)
    arms = await _arms(store, tenant_id, bank_id, query, candidates, vectors, providers, by_id,
                       vector_index=vector_index)
    arms = cap_per_source(arms, query.per_arm)
    ranked = fused_ranking(arms, boost=query.boost)
    if not ranked:
        return RecallOutcome(results=[], trace={"reason": "no arm matched"} if query.trace else {})

    scored: list[tuple[str, float, dict[str, float]]] = []
    today = datetime.now(timezone.utc).date()
    for unit_id, rrf in ranked:
        unit = by_id.get(unit_id)
        if unit is None:
            continue
        recency = recency_signal(unit.occurred_start or unit.mentioned_at, today=today)
        temporal = temporal_signal(
            unit.occurred_start, unit.occurred_end,
            window_start=window[0], window_end=window[1],
        ) if window else 0.5
        base = rrf
        if query.prefer_observations and unit.kind == "fact":
            base *= OBSERVATION_PREFERENCE
        final = combined_score(base=base, proof_count=unit.proof_count, recency=recency, temporal=temporal)
        scored.append((unit_id, final, {"rrf": rrf, "recency": recency, "temporal": temporal}))

    scored.sort(key=lambda item: -item[1])
    reranked = False
    if query.rerank and len(scored) > 1:
        head = scored[:RERANK_TOP]
        cross = await cross_scores(providers, query.query, [by_id[unit_id].text for unit_id, _, _ in head])
        if cross:
            scored = apply_rerank(head, cross) + scored[len(head):]
            reranked = True
    texts = {unit.id: unit.text for unit in units}
    budget = resolve_budget(query.budget, query.max_tokens)
    ordered = [unit_id for unit_id, _, _ in scored]
    chosen, used = select_facts_within_budget(ordered, texts, budget, count_tokens)

    scores_by_id = {unit_id: score for unit_id, score, _ in scored}
    signals = {unit_id: extra for unit_id, _, extra in scored}
    entity_map = store.unit_entities(tenant_id, bank_id)
    results = []
    for unit_id in chosen[: query.limit]:
        unit = by_id[unit_id]
        payload = unit.to_dict()
        payload["scores"] = {
            "final": round(scores_by_id[unit_id], 6),
            "rrf": round(signals[unit_id]["rrf"], 6),
            "recency": round(signals[unit_id]["recency"], 3),
            "temporal": round(signals[unit_id]["temporal"], 3),
        }
        payload["entities"] = entity_map.get(unit_id, [])
        results.append(payload)

    trace = {}
    if query.trace:
        trace = {
            "arms": {arm: len(ids) for arm, ids in arms.items()},
            "fused": len(ranked),
            "kept": len(chosen),
            "reranked": reranked,
            "tokens": used,
            "budget": budget,
        }
    return RecallOutcome(results=results, trace=trace)


def _bank_vectors(store: MemoryStore, tenant_id: str, bank_id: str, vector_index=None) -> dict[str, list[float]]:
    """Vectors the semantic arm may compare against, when the index cannot be asked.

    A vector database is asked per query (index.search) rather than handed the
    whole bank, so nothing is loaded here in that case. The scan needs the rows
    up front; an index that can cheaply return them (the SQLite fallback) is
    asked through the same lookup.
    """
    if vector_index is not None:
        vectors = vector_index.lookup(tenant_id, bank_id)
        return dict(vectors or {})
    return store.embeddings(tenant_id, bank_id)


async def _arms(
    store: MemoryStore,
    tenant_id: str,
    bank_id: str,
    query: RecallQuery,
    candidates: list[Unit],
    vectors: dict[str, list[float]],
    providers: Providers | None,
    by_id: dict[str, Unit],
    *,
    vector_index=None,
) -> dict[str, list[str]]:
    allowed = {unit.id for unit in candidates}
    arms: dict[str, list[str]] = {}

    semantic = await _semantic_arm(
        providers, query.query, vectors, allowed,
        vector_index=vector_index, tenant_id=tenant_id, bank_id=bank_id, limit=query.per_arm,
    )
    if semantic:
        arms["semantic"] = semantic

    bm25 = [
        unit_id
        for unit_id, _ in store.fts_search(
            tenant_id, bank_id, bm25_like(search_terms(query.query)), query.per_arm * 2
        )
        if unit_id in allowed
    ]
    if bm25:
        arms["bm25"] = bm25[: query.per_arm]

    graph = _graph_arm(store, tenant_id, bank_id, query.query, allowed, by_id, query.per_arm,
                       store.alias_map(tenant_id, bank_id))
    if graph:
        arms["graph"] = graph

    temporal = _temporal_arm(candidates, query, query.per_arm)
    if temporal:
        arms["temporal"] = temporal
    return arms


async def _semantic_arm(
    providers: Providers | None,
    query: str,
    vectors: dict[str, list[float]],
    allowed: set[str],
    *,
    vector_index=None,
    tenant_id: str = "",
    bank_id: str = "",
    limit: int = PER_ARM,
) -> list[str]:
    if providers is None or not query.strip():
        return []
    # A vector index answers without the bank being loaded, so the scan's
    # "no vectors held locally" guard must not short-circuit it.
    if vector_index is None and not vectors:
        return []
    try:
        embedded = await providers.embed([query])
    except Exception as exc:  # noqa: BLE001 - an embedding outage degrades, never fails
        logger.warning("hindsight recall: embedding unavailable (%s)", exc)
        return []
    if not embedded:
        return []
    query_vector = embedded[0]
    if vector_index is not None:
        hits = vector_index.search(tenant_id, bank_id, query_vector, max(limit * 2, limit))
        return [unit_id for unit_id, score in hits if unit_id in allowed and score > 0][:limit]
    scored = [
        (unit_id, cosine(query_vector, vector))
        for unit_id, vector in vectors.items()
        if unit_id in allowed
    ]
    scored.sort(key=lambda item: -item[1])
    return [unit_id for unit_id, score in scored if score > 0]


def _graph_arm(
    store: MemoryStore,
    tenant_id: str,
    bank_id: str,
    query: str,
    allowed: set[str],
    by_id: dict[str, Unit],
    per_arm: int,
    aliases: dict[str, str] | None = None,
) -> list[str]:
    """Seed on entities named in the query, then walk links and co-mentions.

    Graph hits are ranked by accumulated weight, with neighbours discounted to
    0.3 so a directly matched unit always outranks what it drags in.
    """
    lowered = (query or "").lower()
    if not lowered:
        return []
    for alias, canonical in (aliases or {}).items():
        if alias and alias in lowered and canonical and canonical.lower() not in lowered:
            lowered += " " + canonical.lower()
    unit_entities = store.unit_entities(tenant_id, bank_id)
    scores: dict[str, float] = {}
    seeded: set[str] = set()
    for unit_id, names in unit_entities.items():
        if unit_id not in allowed:
            continue
        for name in names:
            if name and name.lower() in lowered:
                scores[unit_id] = scores.get(unit_id, 0.0) + 1.0
                seeded.add(unit_id)
                break
    if not seeded:
        return []
    neighbours: dict[str, float] = {}
    for link in store.links(tenant_id, bank_id):
        source, target, weight = link["from_unit"], link["to_unit"], float(link["weight"] or 1.0)
        if source in seeded and target in allowed:
            neighbours[target] = neighbours.get(target, 0.0) + 0.3 * weight
        elif target in seeded and source in allowed:
            neighbours[source] = neighbours.get(source, 0.0) + 0.3 * weight
    for unit_id, weight in neighbours.items():
        scores[unit_id] = scores.get(unit_id, 0.0) + weight
    if not scores:
        return []
    return [unit_id for unit_id, _ in sorted(scores.items(), key=lambda kv: -kv[1])][:per_arm]


def _temporal_arm(candidates: list[Unit], query: RecallQuery, per_arm: int) -> list[str]:
    window = _window(query.temporal_window)
    if window:
        scored = [
            (unit.id, temporal_signal(unit.occurred_start, unit.occurred_end,
                                     window_start=window[0], window_end=window[1]))
            for unit in candidates
        ]
        scored.sort(key=lambda item: -item[1])
        return [unit_id for unit_id, score in scored if score > 0][:per_arm]
    if not query.query_timestamp:
        return []
    pivot = as_date(query.query_timestamp)
    if pivot is None:
        return []
    ranked = sorted(
        candidates,
        key=lambda unit: abs((as_date(unit.occurred_start) or pivot) - pivot).days
        if as_date(unit.occurred_start) else 10**6,
    )
    return [unit.id for unit in ranked][:per_arm]


def _keep(unit: Unit, query: RecallQuery) -> bool:
    if query.types and unit.kind not in query.types:
        return False
    if unit.superseded_by:
        return False
    if query.tags and not _tags_match(unit.tags, query.tags, query.tags_match):
        return False
    window = _window(query.temporal_window)
    if window:
        start, end = window
        occurred = as_date(unit.occurred_start) or as_date(unit.mentioned_at)
        if occurred and not (start <= occurred <= end):
            return False
    return True


def _tags_match(unit_tags: Iterable[str], wanted: Sequence[str], mode: str) -> bool:
    have = {tag for tag in unit_tags if tag}
    want = {tag for tag in wanted if tag}
    if not want:
        return True
    if mode == "all":
        return want <= have
    if mode == "exact":
        return have == want
    if mode == "any_strict":
        return bool(have & want) and have <= want
    if mode == "all_strict":
        return want <= have and have <= want
    return bool(have & want)


def _window(window: dict[str, Any] | None) -> tuple[date, date] | None:
    if not window:
        return None
    start = as_date(str(window.get("start") or window.get("gte") or ""))
    end = as_date(str(window.get("end") or window.get("lte") or ""))
    if start is None or end is None:
        return None
    if start > end:
        start, end = end, start
    return start, end


def resolve_budget(budget: str | int | None, max_tokens: int | None, *, context_tokens: int = 128000) -> int:
    """Resolve the recall budget in tokens.

    An explicit max_tokens wins; a named budget is a fraction of the model's
    context (Hindsight's adaptive rule), clamped so a tiny context still gets a
    usable floor and a huge one cannot flood the prompt.
    """
    if max_tokens and max_tokens > 0:
        return int(max_tokens)
    if isinstance(budget, int) and budget > 0:
        return budget
    fraction = BUDGET_FRACTIONS.get(str(budget or "mid"), BUDGET_FRACTIONS["mid"])
    return max(MIN_BUDGET, min(MAX_BUDGET, int(context_tokens * fraction)))
