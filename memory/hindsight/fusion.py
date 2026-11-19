"""Rank fusion and score shaping, ported from Hindsight.

Everything here is pure: lists of ids in, numbers out. That keeps the four
retrieval arms testable without a database, an LLM or the network.

Upstream references (E:/hindsight/hindsight-api-slim/hindsight_api/engine/):
  search/fusion.py        reciprocal_rank_fusion, cap_per_source
  search/recall_boost.py  BOOST_LEVELS, boosted_rrf_score
  search/reranking.py     recency/temporal/proof boosts
  fact_budget.py          select_facts_within_budget
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Callable, Iterable, Mapping, Sequence

ARM_ORDER: tuple[str, ...] = ("semantic", "bm25", "graph", "temporal")
FUSION_K = 60

RECENCY_ALPHA = 0.2
TEMPORAL_ALPHA = 0.2
PROOF_COUNT_ALPHA = 0.1

BOOST_LEVELS: dict[str, tuple[float, float]] = {
    "low": (2.0, 0.05),
    "medium": (4.0, 0.2),
    "high": (8.0, 0.5),
}

FLAT_STAGE2_ARMS = frozenset({"temporal"})


def cap_per_source(result_lists: Mapping[str, Sequence[str]], cap: int) -> dict[str, list[str]]:
    """Trim each arm to its top cap entries; cap <= 0 disables the limit."""
    if cap <= 0:
        return {arm: list(ids) for arm, ids in result_lists.items()}
    return {arm: list(ids)[:cap] for arm, ids in result_lists.items()}


def reciprocal_rank_fusion(
    result_lists: Mapping[str, Sequence[str]],
    *,
    k: int = FUSION_K,
    boost: str | None = None,
) -> dict[str, float]:
    """Fuse ranked arms into one score per id: sum of 1/(k + rank).

    Ranks are 1-based, the arm order is fixed by ARM_ORDER so results are
    reproducible, and unknown arms are appended in insertion order rather than
    dropped - a future arm should still count, just predictably last.
    """
    divisor, additive = BOOST_LEVELS.get(boost or "", (0.0, 0.0))
    scores: dict[str, float] = {}
    for arm in _ordered_arms(result_lists):
        for rank, item in enumerate(result_lists[arm], start=1):
            if divisor > 0 and arm not in FLAT_STAGE2_ARMS:
                contribution = 1.0 / (k + rank / divisor)
            else:
                contribution = 1.0 / (k + rank)
            if additive > 0 and arm not in FLAT_STAGE2_ARMS:
                contribution += additive * divisor / (divisor + rank - 1)
            scores[item] = scores.get(item, 0.0) + contribution
    return scores


def _ordered_arms(result_lists: Mapping[str, Sequence[str]]) -> list[str]:
    known = [arm for arm in ARM_ORDER if arm in result_lists]
    extra = [arm for arm in result_lists if arm not in ARM_ORDER]
    return known + extra


def fused_ranking(result_lists: Mapping[str, Sequence[str]], *, k: int = FUSION_K,
                  boost: str | None = None) -> list[tuple[str, float]]:
    """Fused scores sorted high to low, ties broken by first appearance."""
    scores = reciprocal_rank_fusion(result_lists, k=k, boost=boost)
    first_seen: dict[str, int] = {}
    for arm in _ordered_arms(result_lists):
        for item in result_lists[arm]:
            first_seen.setdefault(item, len(first_seen))
    return sorted(scores.items(), key=lambda kv: (-kv[1], first_seen.get(kv[0], 0)))


def select_facts_within_budget(
    ordered_ids: Sequence[str],
    text_by_id: Mapping[str, str],
    max_tokens: int,
    count_tokens: Callable[[str], int],
) -> tuple[list[str], int]:
    """Pack ranked ids into a token budget.

    A single oversized entry is skipped, not fatal: the next one may fit. If
    nothing fits and the budget is positive the top-ranked entry is returned
    anyway - a recall that returns nothing is worse than one that overruns by
    a little, which is upstream's explicit floor.
    """
    if max_tokens <= 0:
        return [], 0
    chosen: list[str] = []
    used = 0
    for item in ordered_ids:
        cost = count_tokens(text_by_id.get(item, ""))
        if used + cost <= max_tokens:
            chosen.append(item)
            used += cost
    if not chosen and ordered_ids:
        top = ordered_ids[0]
        return [top], count_tokens(text_by_id.get(top, ""))
    return chosen, used


def as_date(value: str | None) -> date | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m"):
        try:
            parsed = datetime.strptime(text.replace("Z", "+0000"), fmt)
        except ValueError:
            continue
        return parsed.date()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def recency_signal(when: str | None, *, mode: str = "linear", window_days: int = 365,
                   today: date | None = None) -> float:
    """How recent a memory is, as a 0..1 signal (0.5 when unknown).

    linear: 1 - days/window, floored at 0.1 so old memories never vanish.
    exponential: half-life of 90 days.
    A date in the future clamps to 1.0: clock skew must not bury a fresh fact.
    """
    parsed = as_date(when)
    if parsed is None:
        return 0.5
    now = today or datetime.now(timezone.utc).date()
    days = (now - parsed).days
    if days < 0:
        return 1.0
    if mode == "none":
        return 0.5
    if mode == "exponential":
        return max(0.1, 0.5 ** (days / 90.0))
    window = max(1, window_days)
    return max(0.1, 1.0 - days / window)


def temporal_signal(
    occurred_start: str | None,
    occurred_end: str | None,
    *,
    window_start: date | None = None,
    window_end: date | None = None,
) -> float:
    """Proximity of a unit to a query time window.

    Full credit at the middle of the unit's span, decaying linearly to zero at
    the window edges; 0.5 when either side is unknown, so a missing date is
    neutral rather than disqualifying.
    """
    if window_start is None or window_end is None:
        return 0.5
    start = as_date(occurred_start) or as_date(occurred_end)
    end = as_date(occurred_end) or start
    if start is None or end is None:
        return 0.5
    span = (window_end - window_start).days
    if span <= 0:
        return 1.0 if start <= window_end <= end else 0.0
    midpoint = start + (end - start) / 2
    distance = abs((midpoint - window_start).days - span / 2)
    return max(0.0, 1.0 - distance / (span / 2))


def proof_count_signal(proof_count: int) -> float:
    return _clamp(0.5 + math.log(max(1, proof_count)) / 10.0, 0.0, 1.0)


def combined_score(
    *,
    base: float,
    proof_count: int = 1,
    recency: float = 0.5,
    temporal: float = 0.5,
    ce_score: float | None = None,
) -> float:
    """Multiplicative re-rank: relevance * recency * temporal * corroboration.

    Each factor moves at most +-ALPHA off neutral (0.5), so a strong cross
    encoder still wins and a stale date cannot bury a perfect match.
    """
    relevance = base if ce_score is None else ce_score
    score = relevance
    score *= 1.0 + RECENCY_ALPHA * (recency - 0.5)
    score *= 1.0 + TEMPORAL_ALPHA * (temporal - 0.5)
    score *= 1.0 + PROOF_COUNT_ALPHA * (proof_count_signal(proof_count) - 0.5)
    return score


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / math.sqrt(na * nb)


def bm25_like(terms: Iterable[str]) -> str:
    """Build an FTS5 MATCH expression: OR the bigrams, no operator soup."""
    tokens = [term.replace('"', "") for term in terms if term.strip()]
    return " OR ".join(f'"{token}"' for token in tokens)
