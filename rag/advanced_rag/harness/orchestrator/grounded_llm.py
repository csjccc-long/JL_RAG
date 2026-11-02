"""编排器的 LLM 依据性审查（草稿审查）。

灵感源自 Google 的 Sufficient Context Agent——它根据检索到的文本片段审查中间草稿（每个主张的报告），
以判定草稿是否真正有证据依据。

这补充了代码层面的依据性检查（cross_check_claim / _grounded_hit，
该检查是词汇层面的：仅能捕捉缺失的实体/数字）。
LLM 审查是语义层面的：它能捕捉到即使实体存在但关系或主张仍无证据支持的情况
（例如，证据表明“伊萨卡是出生地”，但报告声称“家乡是伊萨卡”；或者证据仅提及开具了某种药物，而报告却过度声称“患者已康复”）。

无依据的主张将作为严重违规项反馈到决策阶梯中，因此，存在幻觉或过度声称的草稿会强制生成带有保留条件的回答或重新进行检索。
"""

from __future__ import annotations

import logging

from rag.prompts.generator import PROMPT_JINJA_ENV, gen_json
from rag.prompts.template import load_prompt

_LOG = logging.getLogger(__name__)

GROUNDED_REVIEW = load_prompt("grounded_select")


async def _llm_chat_json(chat_mdl, prompt_text: str):
    try:
        return await gen_json(prompt_text, "Output:\n", chat_mdl)
    except Exception as exc:  # noqa: BLE001
        _LOG.info("[Grounded-draft] gen_json failed: %s", exc)
        return {}


def _render_reports(reports: list[tuple[str, str]]) -> str:
    """Render claim_id → report lines for the reviewer prompt."""
    if not reports:
        return "(no claims)"
    return "\n".join(f"Claim {cid}: {rpt}" for cid, rpt in reports if rpt)


async def llm_grounded_verify(
    tools,
    question: str,
    reports: list[tuple[str, str]],
    evidence_ids=None,
) -> dict:
    """Draft review: is each claim's report grounded in the cited evidence?

    Parameters
    ----------
    tools : RAGTools
        Must expose ``chat_mdl`` and ``kbinfos``.
    reports : list[(claim_id, report)]
        Each claim's draft text (``AgentResult.report``).
    evidence_ids : list[str] | None
        Union of cited evidence chunk IDs (falls back to a bounded prefix).

    Returns
    -------
    dict : ``{claim_id: {"grounded": bool, "ungrounded": [str, ...]}}``
        Empty dict when the LLM review is unavailable (no chat model, no
        evidence, or a failure) — callers treat that as "no new signal".
    """
    if not reports:
        return {}
    chat_mdl = getattr(tools, "chat_mdl", None)
    if chat_mdl is None:
        return {}

    from rag.advanced_rag.harness.orchestrator.sufficiency_llm import (
        _evidence_md,
        _narrow_keywords,
    )

    evidence_md = _evidence_md(tools, evidence_ids, keywords=_narrow_keywords(question))
    if not evidence_md:
        return {}

    prompt_text = PROMPT_JINJA_ENV.from_string(GROUNDED_REVIEW).render(
        question=question,
        reports=_render_reports(reports),
        evidence=evidence_md,
    )
    _LOG.info("[Grounded-draft] reviewing %d claim report(s) (evidence %d chars)", len(reports), len(evidence_md))
    result = await _llm_chat_json(chat_mdl, prompt_text)

    # The LLM may return a malformed payload (array / scalar / null) instead of a
    # dict. Log and fall back to the documented empty result so we never crash
    # with AttributeError on .get("claims").
    if not isinstance(result, dict):
        _LOG.info("[Grounded-draft] unexpected LLM response type=%s (expected dict); treating as no groundedness signal", type(result).__name__)
        return {}

    out: dict = {}
    for item in result.get("claims") or []:
        cid = str(item.get("claim_id") or "")
        if not cid:
            continue
        ung = item.get("ungrounded_assertions") or []
        ungrounded = []
        for u in ung:
            if isinstance(u, dict):
                ungrounded.append(str(u.get("assertion") or u.get("reason") or ""))
            elif u:
                ungrounded.append(str(u))
        out[cid] = {
            "grounded": bool(item.get("grounded")),
            "ungrounded": [a for a in ungrounded if a],
        }
    return out
