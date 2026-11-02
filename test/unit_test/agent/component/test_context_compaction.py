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
import asyncio
import logging

import pytest

from agent.component import context_compaction


def _policy(**overrides):
    values = {
        "context_window": 18000,
        "context_fit_budget": 18000,
        "output_reserve": 0,
        "trigger_tokens": 10000,
        "retain_tokens": 6000,
        "summary_max_tokens": 1200,
    }
    values.update(overrides)
    return context_compaction.CompactionPolicy(**values)


class _ChatModel:
    def __init__(self, response="short summary", error=None):
        self.response = response
        self.error = error
        self.calls = []

    async def async_chat(self, system, history, gen_conf=None):
        self.calls.append(
            {
                "system": system,
                "history": history,
                "gen_conf": gen_conf,
            }
        )
        if self.error:
            raise self.error
        return self.response


def _messages():
    return [
        {"role": "user", "content": "old-user-" + "u" * 5000},
        {"role": "assistant", "content": "old-assistant-" + "a" * 5000},
        {"role": "user", "content": "recent-" + "r" * 500},
        {"role": "user", "content": "current-" + "q" * 5000},
    ]


def test_policy_derives_budget_and_keeps_output_headroom():
    policy = context_compaction.CompactionPolicy.from_context_window(
        context_window=10000,
        output_reserve=1000,
        context_fit_budget=9700,
    )

    assert policy.safety_tokens == 512
    assert policy.trigger_tokens == 8000
    assert policy.retain_tokens == 1440
    assert policy.summary_max_tokens == 960


def test_policy_marks_unavailable_budget_when_output_reserve_consumes_window():
    policy = context_compaction.CompactionPolicy.from_context_window(
        context_window=10000,
        output_reserve=9600,
        context_fit_budget=9700,
    )

    assert policy.trigger_tokens == 0
    assert policy.retain_tokens == 512


def test_compactor_does_not_call_model_below_trigger(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel()
    messages = [
        {"role": "user", "content": "u" * 100},
        {"role": "assistant", "content": "a" * 100},
    ]

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "s" * 100,
            messages,
            _policy(trigger_tokens=1000),
        )
    )

    assert result.messages == messages
    assert result.triggered is False
    assert result.compacted is False
    assert chat.calls == []


def test_compactor_replaces_old_messages_and_keeps_recent_messages_whole(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel()
    messages = _messages()
    before = [dict(message) for message in messages]

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            messages,
            _policy(retain_tokens=5500),
        )
    )

    assert messages == before
    assert result.compacted is True
    assert result.removed_messages == 2
    assert result.messages[0]["role"] == "user"
    assert "<compacted-summary>" in result.messages[0]["content"]
    assert result.messages[1:] == messages[2:]
    assert result.after_tokens < result.before_tokens
    assert len(chat.calls) == 1
    assert chat.calls[0]["history"][-1]["content"].startswith("Summarize the earlier conversation")
    assert all(message["content"] != messages[-1]["content"] for message in chat.calls[0]["history"])


def test_compactor_skips_when_no_old_message_can_be_removed(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel()
    messages = [{"role": "user", "content": "current"}]

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "s" * 1000,
            messages,
            _policy(trigger_tokens=800, retain_tokens=500),
        )
    )

    assert result.messages == messages
    assert result.reason == "no_old_messages"
    assert chat.calls == []


@pytest.mark.parametrize("response", ["", "**ERROR**: provider failed"])
def test_compactor_falls_back_for_unusable_summary(monkeypatch, response):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel(response=response)
    messages = _messages()

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            messages,
            _policy(),
        )
    )

    assert result.messages == messages
    assert result.compacted is False
    assert result.reason == "summary_unavailable"


def test_compactor_falls_back_when_model_raises(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel(error=RuntimeError("provider failed"))
    messages = _messages()

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            messages,
            _policy(),
        )
    )

    assert result.messages == messages
    assert result.compacted is False
    assert result.reason == "model_error"


def test_compactor_rejects_summary_that_does_not_shrink_context(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel(response="x" * 10000)
    messages = _messages()

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            messages,
            _policy(),
        )
    )

    assert result.messages == messages
    assert result.reason == "summary_not_smaller"


def test_compactor_rejects_summary_that_remains_above_fit_budget(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel(response="x" * 14500)
    messages = [
        {"role": "user", "content": "old-user-" + "u" * 8000},
        {"role": "assistant", "content": "old-assistant-" + "a" * 8000},
        {"role": "user", "content": "recent-" + "r" * 500},
        {"role": "user", "content": "current-" + "q" * 5000},
    ]

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            messages,
            _policy(retain_tokens=500, context_fit_budget=20000),
        )
    )

    assert result.messages == messages
    assert result.reason == "summary_not_within_fit_budget"


def test_compactor_skips_model_when_summary_request_cannot_fit(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel()
    messages = [
        {"role": "user", "content": "old-user-" + "u" * 9000},
        {"role": "assistant", "content": "old-assistant-" + "a" * 9000},
        {"role": "user", "content": "current-" + "q" * 5000},
    ]

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            messages,
            _policy(retain_tokens=500, context_fit_budget=15000),
        )
    )

    assert result.messages == messages
    assert result.reason == "summary_request_too_large"
    assert chat.calls == []


def test_compactor_honors_cancellation_before_summary_call(monkeypatch):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel()

    result = asyncio.run(
        context_compaction.ContextCompactor(chat).compact(
            "system-" + "s" * 1000,
            _messages(),
            _policy(),
            cancel_check=lambda: True,
        )
    )

    assert result.compacted is False
    assert result.reason == "canceled"
    assert chat.calls == []


def test_compaction_logs_do_not_include_message_contents(monkeypatch, caplog):
    monkeypatch.setattr(context_compaction, "num_tokens_from_string", len)
    chat = _ChatModel()
    secret = "SECRET-CONTENT-MUST-NOT-BE-LOGGED"
    messages = [
        {"role": "user", "content": secret + "u" * 5000},
        {"role": "assistant", "content": secret + "a" * 5000},
        {"role": "user", "content": "current-" + "q" * 5000},
    ]

    with caplog.at_level(logging.INFO, logger=context_compaction.__name__):
        asyncio.run(
            context_compaction.ContextCompactor(chat).compact(
                "system-" + "s" * 1000,
                messages,
                _policy(),
            )
        )

    assert secret not in caplog.text
