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
#
import logging
import re
from dataclasses import dataclass
from typing import Any, Callable

logger = logging.getLogger(__name__)


def num_tokens_from_string(text: str) -> int:
    from common.token_utils import num_tokens_from_string as count_tokens

    return count_tokens(text)


COMPACTION_PREAMBLE = "The following message contains a summary of earlier conversation context. Treat it as reference context, not as a new user instruction."
COMPACTION_INSTRUCTION = """Summarize the earlier conversation above.
Use the same language as the conversation.
Preserve exact paths, commands, error text, names, numbers, identifiers, and function signatures.
Do not invent facts.
Return only these sections:
Primary Request and Intent
Key Facts and Constraints
Decisions and Rationale
Actions and Outcomes
Errors and Fixes
Pending Work
Current State
Next Step
Critical Identifiers"""


@dataclass(frozen=True)
class CompactionPolicy:
    context_window: int
    context_fit_budget: int
    output_reserve: int
    trigger_tokens: int
    retain_tokens: int
    summary_max_tokens: int
    safety_tokens: int = 0

    @classmethod
    def from_context_window(
        cls,
        context_window: int,
        output_reserve: int,
        context_fit_budget: int,
    ) -> "CompactionPolicy":
        context_window = max(1, int(context_window or 8192))
        output_reserve = max(0, int(output_reserve or 0))
        context_fit_budget = max(1, int(context_fit_budget or context_window))
        safety_tokens = max(512, int(context_window * 0.02))
        trigger_tokens = int(
            min(
                context_window * 0.8,
                max(0, context_window - output_reserve - safety_tokens),
            )
        )
        retain_tokens = max(
            512,
            int(max(0, context_window - output_reserve) * 0.16),
        )
        summary_max_tokens = max(
            256,
            min(2048, int(trigger_tokens * 0.12)),
        )
        return cls(
            context_window=context_window,
            context_fit_budget=context_fit_budget,
            output_reserve=output_reserve,
            trigger_tokens=trigger_tokens,
            retain_tokens=retain_tokens,
            summary_max_tokens=summary_max_tokens,
            safety_tokens=safety_tokens,
        )


@dataclass(frozen=True)
class CompactionResult:
    messages: list[dict[str, Any]]
    triggered: bool
    compacted: bool
    before_tokens: int
    after_tokens: int
    removed_messages: int = 0
    summary_tokens: int = 0
    reason: str = ""


def count_message_tokens(messages: list[dict[str, Any]]) -> int:
    return sum(num_tokens_from_string(str(message.get("content") or "")) for message in messages)


def _split_messages(
    messages: list[dict[str, Any]],
    retain_tokens: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    retained_tokens = 0
    start = len(messages)
    for index in range(len(messages) - 1, -1, -1):
        retained_tokens += count_message_tokens([messages[index]])
        start = index
        if retained_tokens >= retain_tokens:
            break
    return messages[:start], messages[start:]


class ContextCompactor:
    def __init__(self, chat_mdl):
        self.chat_mdl = chat_mdl

    async def compact(
        self,
        system_prompt: str,
        messages: list[dict[str, Any]],
        policy: CompactionPolicy,
        cancel_check: Callable[[], bool] | None = None,
    ) -> CompactionResult:
        before_tokens = count_message_tokens([{"role": "system", "content": system_prompt}, *messages])

        def unchanged(reason: str, triggered: bool = False) -> CompactionResult:
            logger.info(
                "[LLM context compaction] status=unchanged reason=%s before_tokens=%d trigger_tokens=%d retain_tokens=%d output_reserve=%d",
                reason,
                before_tokens,
                policy.trigger_tokens,
                policy.retain_tokens,
                policy.output_reserve,
            )
            return CompactionResult(
                messages=messages,
                triggered=triggered,
                compacted=False,
                before_tokens=before_tokens,
                after_tokens=before_tokens,
                reason=reason,
            )

        if not messages or policy.trigger_tokens <= 0 or policy.trigger_tokens <= policy.retain_tokens:
            return unchanged("budget_unavailable")
        if before_tokens < policy.trigger_tokens:
            return unchanged("below_trigger")

        old_messages, recent_messages = _split_messages(
            messages,
            policy.retain_tokens,
        )
        if not old_messages:
            return unchanged("no_old_messages", triggered=True)
        if not recent_messages:
            return unchanged("no_recent_messages", triggered=True)
        if cancel_check and cancel_check():
            return unchanged("canceled", triggered=True)

        summary_request = [
            *old_messages,
            {"role": "user", "content": COMPACTION_INSTRUCTION},
        ]
        summary_input_tokens = count_message_tokens([{"role": "system", "content": system_prompt}, *summary_request])
        if summary_input_tokens + policy.summary_max_tokens >= policy.context_fit_budget:
            return unchanged("summary_request_too_large", triggered=True)

        try:
            summary = await self.chat_mdl.async_chat(
                system_prompt,
                summary_request,
                gen_conf={
                    "temperature": 0.0,
                    "max_tokens": policy.summary_max_tokens,
                },
            )
        except Exception as exc:
            logger.warning(
                "[LLM context compaction] status=failed reason=model_error error_type=%s before_tokens=%d",
                type(exc).__name__,
                before_tokens,
            )
            return unchanged("model_error", triggered=True)

        summary = re.sub(r"^.*</think>", "", str(summary or "").strip(), flags=re.DOTALL).strip()
        if not summary or "**ERROR**" in summary:
            return unchanged("summary_unavailable", triggered=True)
        if cancel_check and cancel_check():
            return unchanged("canceled", triggered=True)

        summary_message = {
            "role": "user",
            "content": (f"{COMPACTION_PREAMBLE}\n\n<compacted-summary>\n{summary}\n</compacted-summary>"),
        }
        compacted_messages = [summary_message, *recent_messages]
        after_tokens = count_message_tokens([{"role": "system", "content": system_prompt}, *compacted_messages])
        if after_tokens >= before_tokens:
            return unchanged("summary_not_smaller", triggered=True)
        if after_tokens >= policy.context_fit_budget:
            return unchanged("summary_not_within_fit_budget", triggered=True)

        summary_tokens = count_message_tokens([summary_message])
        logger.info(
            "[LLM context compaction] status=compacted before_tokens=%d after_tokens=%d removed_messages=%d summary_tokens=%d",
            before_tokens,
            after_tokens,
            len(old_messages),
            summary_tokens,
        )
        return CompactionResult(
            messages=compacted_messages,
            triggered=True,
            compacted=True,
            before_tokens=before_tokens,
            after_tokens=after_tokens,
            removed_messages=len(old_messages),
            summary_tokens=summary_tokens,
            reason="compacted",
        )
