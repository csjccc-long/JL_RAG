"""充分性判定决策阶梯——以LLM自动评分器作为主要判定者，以智能体置信度为风险门控（Sufficient Context论文，arXiv 2411.06037）。

这取代了旧的“代码交叉检查 + 双信号加权融合 + 5路判定”流水线。由于运维人员无法训练/校准融合权重（论文中的逻辑回归），
我们使用单调阈值阶梯：LLM自动评分器决定证据是否足以推断出合理的答案；智能体的自我评估置信度仅调节判定结果的呈现方式（完整答案 vs. 带警示的答案 vs. 调和）。唯一的连续自由度是保守性阈值（c_high / c_low / llm_floor），它们是产品策略调节旋钮，而非学习参数。

语义（论文§3 / §5.1）：

充分性 = “可以从上下文中推断出合理的答案A'”，独立于该答案是否正确，且无需真实标签。
选择性生成 = 置信度不重新评分LLM的充分性判定；它仅决定是否完整回答、添加警示或进行调查。

动作：

ANSWER 完整答案（充分 + 高置信度）
ANSWER_WITH_CAVEAT 带明确警示的答案
GAP 针对具体缺失部分进行后续搜索
RECONCILE 重新调查低置信度/矛盾点
UNANSWERABLE 无法回答（或回退到直接LLM）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Action constants (shared with callers / orchestrators).
ANSWER = "ANSWER"
ANSWER_WITH_CAVEAT = "ANSWER_WITH_CAVEAT"
GAP = "GAP"
RECONCILE = "RECONCILE"
UNANSWERABLE = "UNANSWERABLE"


@dataclass
class LadderOutput:
    """Result of the decision ladder."""

    action: str
    should_continue: bool
    caveat: str = ""
    missing: list[str] = field(default_factory=list)


def aggregate_agent_confidence(
    agent_results: list[Any],
    hard_violations: set[str] | dict[str, list[str]] | None = None,
) -> float:
    """Mean self-confidence over the trusted (self-verified, no hard veto) claims.

    No weights, no normalization — we only pick the trustworthy subset and take
    the mean. Hard vetoes (required-entity gaps, grounded-fact violations,
    numeric conflicts) suppress a claim's confidence entirely, so a confidence
    signal can never mask a missing-evidence gap (selective generation).
    """
    violations: set[str] = set()
    if hard_violations:
        if isinstance(hard_violations, dict):
            violations = set(hard_violations.keys())
        else:
            violations = set(hard_violations)

    trusted = [r for r in agent_results if getattr(r, "is_verified", False) and getattr(r, "claim_id", "") not in violations]
    if not trusted:
        return 0.0
    total = 0.0
    for r in trusted:
        try:
            total += float(getattr(r, "confidence", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue
    return total / len(trusted)


def sufficiency_ladder(
    *,
    auto_sufficient: bool,
    auto_confidence: float,
    missing: list[str],
    contradictions: list[str],
    agent_confidence: float,
    c_high: float,
    c_low: float,
    llm_floor: float,
    allows_reconcile: bool,
    cycle: int,
    max_cycles: int,
    hard_violations: set[str] | dict[str, list[str]] | None = None,
) -> LadderOutput:
    """Evaluate the decision ladder and return the action.

    Parameters
    ----------
    auto_sufficient : bool
        LLM AutoRater's verdict (a plausible answer can be inferred).
    auto_confidence : float
        AutoRater's own confidence in its sufficiency judgment.
    missing : list[str]
        Concrete gaps when AutoRater says insufficient.
    contradictions : list[str]
        Evidence-internal contradictions (even if sufficient, caveat).
    agent_confidence : float
        Aggregated agent self-confidence (0..1).
    c_high / c_low : float
        Agent-confidence gates for full vs. caveated answer.
    llm_floor : float
        If AutoRater confidence < this, re-investigate regardless of verdict.
    allows_reconcile : bool
        Whether the mode can force a re-investigation (medium=False).
    cycle / max_cycles : int
        0-based current cycle and the mode's budget.
    hard_violations : set | dict
        Claim IDs (or {id: gaps}) with a proven evidence gap (required entity
        missing / grounded absent / numeric conflict). Any non-empty value
        forces a caveated answer even if AutoRater says sufficient.
    """
    violations: set[str] = set()
    if hard_violations:
        violations = set(hard_violations.keys()) if isinstance(hard_violations, dict) else set(hard_violations)

    # 1. Hard veto floor: code-proven evidence gap beats the LLM's "good enough".
    if violations:
        return LadderOutput(
            action=ANSWER_WITH_CAVEAT,
            should_continue=False,
            caveat=f"hard evidence gap in claim(s): {sorted(violations)[:6]}",
            missing=missing,
        )

    # 2. AutoRater says insufficient.
    if not auto_sufficient:
        if missing:
            return LadderOutput(action=GAP, should_continue=True, missing=missing)
        return LadderOutput(action=UNANSWERABLE, should_continue=False, missing=missing)

    # 3. AutoRater is not confident in its own sufficiency call.
    if auto_confidence < llm_floor:
        if allows_reconcile and cycle < max_cycles - 1:
            return LadderOutput(
                action=RECONCILE,
                should_continue=True,
                caveat="AutoRater itself is unsure; re-investigating",
            )
        return LadderOutput(
            action=ANSWER_WITH_CAVEAT,
            should_continue=False,
            caveat="AutoRater sufficiency judgment is low-confidence",
        )

    # 4. Sufficient + confident: agent confidence sets the presentation.
    caveat = ""
    should_continue = False
    if agent_confidence >= c_high:
        action = ANSWER
    elif agent_confidence >= c_low:
        action = ANSWER_WITH_CAVEAT
        caveat = "evidence partially supports the answer"
    elif allows_reconcile and cycle < max_cycles - 1:
        action = RECONCILE
        should_continue = True
    else:
        action = ANSWER_WITH_CAVEAT
        caveat = "evidence partially supports the answer"

    if contradictions:
        # Never silently pick one side of a contradiction; surface it.
        caveat = "evidence contains conflicting figures"
        action = ANSWER_WITH_CAVEAT
        should_continue = False

    return LadderOutput(action=action, should_continue=should_continue, caveat=caveat, missing=missing)
