"""Planner node — question-type-aware claim decomposition."""

import json
import logging
import re

from rag.advanced_rag.agentic_rag_graph import _snip
from rag.advanced_rag.harness.types import ClaimTarget, WorkflowPlan, RouteDecision
from rag.advanced_rag.harness.config import get_mode
from rag.advanced_rag.harness.prompts.decompose_prompts import (
    DECOMPOSE_FACTUAL,
    DECOMPOSE_COMPARATIVE,
    DECOMPOSE_PROCEDURAL,
    DECOMPOSE_EXPLORATORY,
)
"""
planner_node 入口
    ↓
[1] 从 state 获取 route
    ↓
[2] 判断 route 是否存在
    ├─ 不存在 → 记录警告 → 调用 _default_plan → 返回直接计划
    └─ 存在 → 继续
    ↓
[3] 判断 route.requires_decomposition 是否为 False
    ├─ 是 → 调用 _direct_plan → 返回直接计划
    └─ 否 → 继续
    ↓
[4] 按问题类型选择分解提示词
    ├─ factual → DECOMPOSE_FACTUAL
    ├─ comparative → DECOMPOSE_COMPARATIVE
    ├─ procedural → DECOMPOSE_PROCEDURAL
    ├─ analytical → DECOMPOSE_EXPLORATORY
    ├─ exploratory → DECOMPOSE_EXPLORATORY
    └─ 其他 → DECOMPOSE_FACTUAL（默认）
    ↓
[5] 获取模式参数
    ├─ max_claims = _get_max_claims(mode.label)
    │   ├─ low → 1
    │   ├─ medium → 3
    │   ├─ high → 5
    │   └─ ultra → 8
    └─ detail_level = _get_detail_level(mode.label)
        ├─ low → coarse
        ├─ medium → normal
        ├─ high → fine
        └─ ultra → extra_fine
    ↓
[6] 格式化初步搜索结果
    ├─ 调用 _format_seed_chunks(seed_chunks, tools)
    ├─ 无结果 → 返回 "(no preliminary results)"
    └─ 有结果 → 格式化为文本块
    ↓
[7] 检查重规划反馈
    ├─ feedback 为空 → 不追加
    └─ feedback 非空 → 追加到系统提示，要求新计划必须解决 !!!缺口
    ↓
[8] 构建提示词并拆分
    ├─ 使用 decompose_prompt.format(question, max_claims, detail_level, retrieved)
    └─ 按 "Output format" 拆分为 system 和 user 两部分
    ↓
[9] 调用 LLM 分解问题
    ├─ 调用 tools.chat_mdl.async_chat(system, user, temperature=0.2)
    ├─ 返回元组 → 取第一个元素
    └─ 调用异常 → 记录异常 → 调用 _direct_plan → 返回
    ↓
[10] 解析 LLM 响应
    ├─ 调用 _extract_json(ans)
    ├─ 移除 think 标签
    ├─ 移除 markdown 围栏
    ├─ 尝试 json_repair.loads
    ├─ 失败则尝试 json.loads
    └─ 都失败 → 返回 {}
    ↓
[11] 确定计划类型
    ├─ factual → fact_decomposition
    ├─ comparative → comparative_decomposition
    ├─ procedural → procedural_decomposition
    └─ 其他 → exploratory_decomposition
    ↓
[12] 构建 ClaimTarget 列表
    ├─ 遍历 claims_raw
    ├─ 跳过非字典项
    ├─ 跳过缺少 description 的项
    └─ 生成 ClaimTarget(claim_id, description, priority, suggested_tools)
    ↓
[13] 判断 claims 是否为空
    ├─ 为空 → 调用 _direct_plan → 返回
    └─ 非空 → 继续
    ↓
[14] 构建 WorkflowPlan
    ├─ plan_type = 步骤 11 的结果
    ├─ claims = 步骤 12 的结果
    └─ max_iterations = mode.max_orchestrator_cycles
    ↓
[15] 记录日志并返回
    ├─ 日志：分解为 N 个研究步骤
    └─ 返回 {"plan": plan, "claims": plan.claims}
"""

_LOG = logging.getLogger(__name__)


def _extract_json(text: str) -> dict:
    text = re.sub(r"^.*</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
    try:
        import json_repair

        return json_repair.loads(text)
    except Exception:
        try:
            return json.loads(text)
        except Exception:
            _LOG.warning("planner: failed to parse LLM output: %s", text[:200])
            return {}


async def planner_node(state: dict, tools) -> dict:
    """Planner node — decompose question into claims based on question type."""
    route: RouteDecision = state.get("route")
    if not route:
        _LOG.warning("planner: no route found, using defaults")
        return _default_plan(state.get("question", ""))

    _LOG.info('[Planner] Working out how to research this %s question: "%s"', route.question_type, _snip(route.question))
    if not route.requires_decomposition:
        # Direct mode: single coarse claim
        return _direct_plan(route.question)

    # Select decompose prompt by question type
    prompt_map = {
        "factual": DECOMPOSE_FACTUAL,
        "comparative": DECOMPOSE_COMPARATIVE,
        "procedural": DECOMPOSE_PROCEDURAL,
        "analytical": DECOMPOSE_EXPLORATORY,
        "exploratory": DECOMPOSE_EXPLORATORY,
    }
    decompose_prompt = prompt_map.get(route.question_type, DECOMPOSE_FACTUAL)

    mode = get_mode(route.thinking_mode)
    max_claims = _get_max_claims(mode.label)
    detail_level = _get_detail_level(mode.label)
    retrieved = _format_seed_chunks(state.get("seed_chunks"), tools)

    try:
        prompt = decompose_prompt.format(
            question=route.question,
            max_claims=max_claims,
            detail_level=detail_level,
            retrieved=retrieved,
        )
        system, user = prompt.split("Output format", 1)
        system = system.strip()
        user = "Output format" + user
        # Replanning: the orchestrator sets ``feedback`` from the sufficiency
        # verdict — the new plan must close those gaps instead of repeating
        # the previous one.
        feedback = (state.get("feedback") or "").strip()
        if feedback:
            system += (
                "\n\nA previous research round already ran and left gaps. "
                "Feedback from the sufficiency check — the new plan MUST address "
                "these points with different, more targeted claims:\n" + feedback
            )
        msg = await tools._fit_messages(system, user)
        ans = await tools.chat_mdl.async_chat(msg[0]["content"], msg[1:], {"temperature": 0.2})
        if isinstance(ans, tuple):
            ans = ans[0]
        result = _extract_json(ans)
    except Exception:
        _LOG.exception("planner_node failed")
        return _direct_plan(route.question)

    claims_raw = result.get("claims", [])
    plan_type = {
        "factual": "fact_decomposition",
        "comparative": "comparative_decomposition",
        "procedural": "procedural_decomposition",
    }.get(route.question_type, "exploratory_decomposition")

    claims = []
    for i, c in enumerate(claims_raw):
        if isinstance(c, dict) and c.get("description"):
            claims.append(
                ClaimTarget(
                    claim_id=c.get("claim_id", f"c{i}"),
                    description=c["description"],
                    priority=c.get("priority", 0),
                    suggested_tools=c.get("suggested_tools", []),
                )
            )

    if not claims:
        return _direct_plan(route.question)

    plan = WorkflowPlan(
        plan_type=plan_type,
        claims=claims,
        max_iterations=mode.max_orchestrator_cycles,
    )
    _LOG.info("[Planner] Broke the question into %d research step(s): %s", len(plan.claims), "; ".join(f'"{c.description}"' for c in plan.claims))

    return {"plan": plan, "claims": plan.claims}


def _format_seed_chunks(seed_chunks, tools) -> str:
    """Render preliminary-search chunks as grounding context for the planner."""
    if not seed_chunks:
        return "(no preliminary results)"
    try:
        from rag.prompts.generator import kb_prompt

        blocks = kb_prompt({"chunks": seed_chunks, "doc_aggs": []}, tools.chat_mdl.max_length)
        text = "\n".join(blocks).strip()
        return text or "(no preliminary results)"
    except Exception:
        _LOG.exception("planner: failed to format seed chunks")
        return "(no preliminary results)"


def _direct_plan(question: str) -> dict:
    """Single-claim plan for non-decomposed mode."""
    plan = WorkflowPlan(
        plan_type="direct",
        claims=[ClaimTarget(claim_id="c0", description=question, priority=0)],
        max_iterations=1,
    )
    return {"plan": plan, "claims": plan.claims}


def _default_plan(question: str) -> dict:
    return _direct_plan(question)


def _get_max_claims(mode_label: str) -> int:
    return {"low": 1, "medium": 3, "high": 5, "ultra": 8}.get(mode_label, 3)


def _get_detail_level(mode_label: str) -> str:
    return {"low": "coarse", "medium": "normal", "high": "fine", "ultra": "extra_fine"}.get(mode_label, "normal")
