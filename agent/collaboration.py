#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from typing import Any
"""
这个文件 collaboration.py 的作用，是把多个 worker 的回答统一解析成结构化数据，并在协作型 Agent 场景中做“投票、裁决、汇总”这类后处理。
它不是执行 Agent 本身，而是提供一个标准化的“协作结果解释器”和“合并器”。

代码开头定义了几个常量，比如：

VOTE_OUTPUT_INSTRUCTION
JUDGE_OUTPUT_INSTRUCTION
DEBATE_JUDGE_INSTRUCTION
它们本质上是在告诉各个 Agent：你在协作场景中返回的内容必须遵守一定格式，尤其是投票和裁决要输出 JSON，不能乱写。
这体现了这个模块对“协作结果结构化”的要求：如果每个 worker 都不按格式返回，后续的统计和汇总就无法稳定工作。

接着定义了 _json_object()，它会在一段文本里找出第一个 JSON 对象并解析。
这很关键，因为很多 LLM 输出不会纯粹只返回 JSON，有时会夹带说明文本、代码块或前缀。这个函数相当于把无结构文本“修正”为可解析对象，并为后续投票、评审逻辑提供统一入口。

parse_vote() 是投票解析器。它接收 task_index、worker_id 和文本内容，要求返回一条结构化投票结果，必须包含：

choice
confidence
rationale（可选）
status
error
并且会校验：

是否为空
是否是 JSON 对象
choice 是否非空字符串
confidence 是否是有限非负数
如果不符合规则，它会返回 status: "invalid" 和错误信息。
这说明投票不是简单字符串比较，而是需要“格式化后的决策结果”。

parse_judge() 则是裁决器解析器。它接收一段文本和候选列表，要求从文本中抽出一个合法的候选，并返回：

choice
rationale
status
error
它既支持 JSON 对象，也支持从纯文本中判断，如果没有任何候选命中，则标记无效。
这使它适合用在“评委评估多个候选方案”的场景。

tally_votes() 是投票汇总器。它把多名 worker 的投票结果累计成：

各选择项的票数
各选择项的总 confidence
胜者
是否平局
tie_break 策略
这部分实质上是协作型 Agent 中的“多数决/加权决策”逻辑：多个 worker 先各自投票，然后统计结果，得到最终 winner。

consensus_choice() 则要求“所有投票都必须一致”，如果不是全体一致，就返回空字符串，表示没有形成共识。
这意味着它还支持“共识模式”，不是所有协作都一定要多数决，而是部分模式要求统一意见。

build_previous_round_context() 会把历史轮次的有效回答拼装成上下文，让下一轮的协作基于之前的结论继续推进。
它会过滤掉无效或错误结果，每次会将上一轮自己的输出排除只保留有效输出，形成“历史结论摘要”。
这对 debate、multi-round reasoning 很有帮助。

summarize_responses() 则更简单：把所有有效响应拼成一段文本摘要，给后续 judge 或 manager 使用。
它的核心是把不同 worker 的答案聚合成一句整合后的文本，而不是专门做投票统计
"""

VOTE_OUTPUT_INSTRUCTION = 'Return exactly one JSON object with "choice" (non-empty string), "confidence" (finite non-negative number), and optional "rationale".'
JUDGE_OUTPUT_INSTRUCTION = 'Choose one candidate and return exactly one JSON object with "choice" and optional "rationale".'
DEBATE_JUDGE_INSTRUCTION = "Summarize the debate, identify the strongest arguments, and state a clear conclusion. Do not invent evidence that was not provided."


def _json_object(text: str) -> Mapping[str, Any] | None:
    decoder = json.JSONDecoder()
    for start, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text[start:])
        except (TypeError, ValueError):
            continue
        if isinstance(value, Mapping):
            return value
    return None


def parse_vote(task_index: int, worker_id: str, text: str) -> dict[str, Any]:
    vote = {
        "task_index": task_index,
        "worker_id": worker_id,
        "choice": "",
        "confidence": 0.0,
        "rationale": "",
        "status": "invalid",
        "error": "",
    }
    if not text.strip():
        vote["error"] = "vote content is empty"
        return vote

    payload = _json_object(text)
    if payload is None:
        vote["error"] = "vote content is not a JSON object"
        return vote

    raw_choice = payload.get("choice")
    if not isinstance(raw_choice, str) or not raw_choice.strip():
        vote["error"] = "vote choice must be a non-empty string"
        return vote

    confidence = payload.get("confidence", 0)
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        vote["error"] = "vote confidence must be a non-negative number"
        return vote
    confidence = float(confidence)
    if not math.isfinite(confidence) or confidence < 0:
        vote["error"] = "vote confidence must be a finite non-negative number"
        return vote

    vote.update(
        {
            "choice": raw_choice.strip(),
            "confidence": confidence,
            "rationale": str(payload.get("rationale") or "").strip(),
            "status": "valid",
        }
    )
    return vote


def parse_judge(text: str, candidates: Sequence[str]) -> dict[str, Any]:
    normalized_candidates = tuple(dict.fromkeys(candidate.strip() for candidate in candidates if candidate and candidate.strip()))
    decision = {
        "choice": "",
        "rationale": "",
        "status": "invalid",
        "error": "",
    }
    if not text.strip():
        decision["error"] = "judge returned no content"
        return decision
    if not normalized_candidates:
        decision["error"] = "judge has no candidates"
        return decision

    payload = _json_object(text)
    if payload is not None:
        choice = payload.get("choice")
        rationale = str(payload.get("rationale") or "").strip()
    else:
        choice = text.strip().strip("`").strip().strip("\"'")
        rationale = ""

    if not isinstance(choice, str) or choice.strip() not in normalized_candidates:
        decision["error"] = "judge choice is not one of the candidates"
        return decision

    decision.update(
        {
            "choice": choice.strip(),
            "rationale": rationale,
            "status": "valid",
        }
    )
    return decision


def tally_votes(votes: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    confidence: dict[str, float] = {}
    for vote in votes:
        if vote.get("status") != "valid":
            continue
        choice = str(vote.get("choice") or "").strip()
        if not choice:
            continue
        counts[choice] = counts.get(choice, 0) + 1
        confidence[choice] = confidence.get(choice, 0.0) + float(vote.get("confidence") or 0.0)

    if not counts:
        return {
            "winner": "",
            "tie_break": "none",
            "tied": [],
            "counts": {},
            "confidence": {},
        }

    max_count = max(counts.values())
    count_leaders = [choice for choice, count in counts.items() if count == max_count]
    if len(count_leaders) == 1:
        return {
            "winner": count_leaders[0],
            "tie_break": "count",
            "tied": [],
            "counts": counts,
            "confidence": confidence,
        }

    max_confidence = max(confidence[choice] for choice in count_leaders)
    confidence_leaders = [choice for choice in count_leaders if confidence[choice] == max_confidence]
    return {
        "winner": confidence_leaders[0] if len(confidence_leaders) == 1 else "",
        "tie_break": "confidence" if len(confidence_leaders) == 1 else "none",
        "tied": count_leaders,
        "counts": counts,
        "confidence": confidence,
    }


def consensus_choice(votes: Sequence[Mapping[str, Any]], expected_count: int) -> str:
    if expected_count < 1 or len(votes) != expected_count:
        return ""
    if any(vote.get("status") != "valid" for vote in votes):
        return ""
    choices = {str(vote.get("choice") or "").strip() for vote in votes}
    if len(choices) != 1:
        return ""
    choice = next(iter(choices))
    return choice if choice else ""


def build_previous_round_context(responses: Sequence[Mapping[str, Any]], current_task_index: int) -> str:
    parts = []
    for response in responses:
        if response.get("task_index") == current_task_index:
            continue
        if response.get("status") != "ok":
            continue
        content = str(response.get("content") or "").strip()
        if not content:
            continue
        task_index = response.get("task_index", "?")
        worker_id = response.get("worker_id", "unknown")
        parts.append(f"Participant task {task_index} ({worker_id}):\n{content}")
    if not parts:
        return ""
    return "PREVIOUS ROUND:\n" + "\n\n".join(parts)


def summarize_responses(responses: Sequence[Mapping[str, Any]]) -> str:
    parts = []
    for response in responses:
        if response.get("status") != "ok":
            continue
        content = str(response.get("content") or "").strip()
        if not content:
            continue
        parts.append(f"{response.get('worker_id', 'unknown')}:\n{content}")
    return "\n\n".join(parts)
