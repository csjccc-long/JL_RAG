"""Cross-encoder re-ranking for the native recall pipeline.

The fused ranking is deliberately cheap and model-free: RRF over four arms plus
recency/temporal/corroboration boosts. That is good at *finding* candidates but
blind to how well a memory actually answers the question, because a shared rare
word can outrank a paraphrase.

This module adds the missing second stage. When the tenant configured a rerank
model the top candidates go through the real cross-encoder; otherwise a lexical
overlap scorer stands in so the pipeline keeps the same shape and never calls a
model it does not have. Either way the cross score nudges, it does not replace,
the fused score, so a noisy reranker cannot bury a strong lexical match.
"""

from __future__ import annotations

import logging
import math
import re
from typing import Sequence

from memory.hindsight.llm import Providers
from memory.hindsight.tokens import search_terms, tokenize

logger = logging.getLogger(__name__)

RERANK_TOP = 24
RERANK_ALPHA = 0.4
_WORD = re.compile(r"[a-z0-9_]+|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", re.IGNORECASE)


def _words(text: str) -> list[str]:
    return [w.lower() for w in _WORD.findall(text or "")]


def lexical_scores(query: str, docs: Sequence[str]) -> list[float]:
    """Overlap-based stand-in for a cross encoder, in [0, 1].

    Term overlap is weighted by inverse document frequency over the candidate
    set so a word every memory shares contributes nothing, and adjacent-pair
    overlap is added because Chinese has no spaces and bigrams carry most of
    the signal a bag of characters loses.
    """
    if not docs:
        return []
    query_terms = {term for term in search_terms(query) if term}
    if not query_terms:
        return [0.0 for _ in docs]
    doc_terms = [set(term for term in tokenize(doc).split() if term) for doc in docs]

    document_frequency: dict[str, int] = {}
    for terms in doc_terms:
        for term in query_terms & terms:
            document_frequency[term] = document_frequency.get(term, 0) + 1
    total = len(docs)
    weights = {
        term: math.log(1.0 + total / (1.0 + count))
        for term, count in document_frequency.items()
    }
    weight_total = sum(weights.values()) or 1.0

    query_words = _words(query)
    query_pairs = set(zip(query_words, query_words[1:]))
    scores: list[float] = []
    for doc, terms in zip(docs, doc_terms):
        overlap = sum(weights.get(term, 0.0) for term in query_terms & terms)
        base = overlap / weight_total
        if query_pairs:
            doc_words = _words(doc)
            doc_pairs = set(zip(doc_words, doc_words[1:]))
            base = 0.75 * base + 0.25 * (len(query_pairs & doc_pairs) / len(query_pairs))
        scores.append(max(0.0, min(1.0, base)))
    return scores


async def cross_scores(
    providers: Providers | None,
    query: str,
    docs: Sequence[str],
) -> list[float] | None:
    """Model scores when a reranker exists, lexical scores otherwise.

    Returns None when there is nothing to rerank so the caller can skip the
    stage without special-casing an empty list.
    """
    if not docs or not query.strip():
        return None
    rerank = getattr(providers, "rerank", None)
    if rerank is not None:
        try:
            scores = await rerank(query, list(docs))
            if scores and len(scores) == len(docs):
                return [max(0.0, min(1.0, float(score))) for score in scores]
        except Exception as exc:  # noqa: BLE001 - a reranker outage must not fail recall
            logger.warning("hindsight rerank: model unavailable (%s)", exc)
    return lexical_scores(query, docs)


def apply_rerank(
    entries: Sequence[tuple[str, float, dict[str, float]]],
    scores: Sequence[float],
    *,
    alpha: float = RERANK_ALPHA,
) -> list[tuple[str, float, dict[str, float]]]:
    """Fold cross scores into fused scores, keeping the original ordering key."""
    adjusted: list[tuple[str, float, dict[str, float]]] = []
    for (unit_id, final, signals), ce in zip(entries, scores):
        boosted = final * (1.0 + alpha * (ce - 0.5))
        extra = dict(signals)
        extra["rerank"] = ce
        adjusted.append((unit_id, boosted, extra))
    adjusted.sort(key=lambda item: -item[1])
    return adjusted
