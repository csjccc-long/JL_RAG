import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.component.llm import LLM, LLMParam


def _llm(prompts=None):
    cpn = LLM.__new__(LLM)
    cpn._param = LLMParam()
    cpn._param.prompts = prompts or [{"role": "user", "content": "User query: {sys.query}"}]
    return cpn


@pytest.mark.p1
def test_sys_prompt_and_msg_replaces_trailing_user_instead_of_skipping():
    cpn = _llm()
    msg, _ = cpn._sys_prompt_and_msg([{"role": "user", "content": ""}], {"sys.query": "test"})
    assert msg == [{"role": "user", "content": "User query: test"}]


@pytest.mark.p1
def test_sys_prompt_and_msg_keeps_consecutive_configured_prompts():
    cpn = _llm(
        [
            {"role": "user", "content": "Context: {sys.query}"},
            {"role": "user", "content": "User query: {sys.query}"},
        ]
    )
    msg, _ = cpn._sys_prompt_and_msg([], {"sys.query": "test"})
    assert msg == [
        {"role": "user", "content": "Context: test"},
        {"role": "user", "content": "User query: test"},
    ]


@pytest.mark.p1
def test_validate_fitted_messages_requires_trailing_user():
    err = LLM.validate_fitted_messages(
        [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "still here"},
            {"role": "assistant", "content": "reply"},
        ]
    )
    assert err and "empty" in err.lower()


@pytest.mark.p1
def test_validate_fitted_messages_rejects_empty_user():
    err = LLM.validate_fitted_messages([{"role": "system", "content": "system"}, {"role": "user", "content": ""}])
    assert err and "empty" in err.lower()


@pytest.mark.p1
def test_fit_messages_uses_default_context_when_max_length_zero():
    msg_fit, err = LLM.fit_messages(
        "s" * 845,
        [{"role": "user", "content": "User query: test"}],
        0,
    )
    assert err is None
    assert msg_fit[-1]["content"] == "User query: test"


@pytest.mark.p1
def test_gen_conf_includes_zero_temperature_when_enabled():
    """Include an explicitly enabled zero temperature in the model configuration."""
    param = LLMParam()
    param.temperature = 0
    param.temperatureEnabled = True

    assert param.gen_conf()["temperature"] == 0


class _CompactionChatModel:
    max_length = 10000

    def __init__(self):
        self.calls = 0

    async def async_chat(self, system, history, gen_conf=None):
        self.calls += 1
        return "summary"


@pytest.mark.p1
def test_compact_messages_does_not_mutate_input(monkeypatch):
    monkeypatch.setattr("agent.component.context_compaction.num_tokens_from_string", len)
    cpn = _llm()
    cpn.chat_mdl = _CompactionChatModel()
    cpn.check_if_canceled = lambda _message="": False
    messages = [
        {"role": "user", "content": "old-" + "u" * 4000},
        {"role": "assistant", "content": "old-" + "a" * 4000},
        {"role": "user", "content": "current-" + "q" * 4000},
    ]
    before = [dict(message) for message in messages]

    result = asyncio.run(cpn._compact_messages("system-" + "s" * 200, messages, {}))

    assert messages == before
    assert result is not messages
    assert result[0]["content"].startswith("The following message contains a summary")
    assert result[-1] == messages[-1]


@pytest.mark.p1
def test_stream_output_compacts_before_fitting(monkeypatch):
    cpn = _llm()
    cpn.imgs = []
    cpn.chat_mdl = SimpleNamespace(max_length=1000)
    cpn._get_chat_template_kwargs = lambda: {}
    compacted = [{"role": "user", "content": "compacted"}]
    cpn._compact_messages = AsyncMock(return_value=compacted)
    cpn.fit_messages = MagicMock(
        return_value=(
            [
                {"role": "system", "content": "system"},
                {"role": "user", "content": "compacted"},
            ],
            None,
        )
    )
    streamed_gen_conf = {}
    cpn.check_if_canceled = lambda _message="": False
    cpn.set_output = MagicMock()

    async def fake_stream(_system, _history, gen_conf, **_kwargs):
        streamed_gen_conf["value"] = gen_conf
        yield "answer"

    cpn.chat_mdl.async_chat_streamly_delta = fake_stream

    async def fake_delta(stream, min_tokens=0):
        async for value in stream:
            yield None, value, None

    monkeypatch.setattr("agent.component.llm._stream_with_think_delta", fake_delta)

    async def collect():
        return [value async for value in cpn._stream_output_async("system", [{"role": "user", "content": "query"}])]

    output = asyncio.run(collect())

    cpn._compact_messages.assert_awaited_once()
    cpn.fit_messages.assert_called_once()
    assert cpn.fit_messages.call_args.args[1] is compacted
    assert streamed_gen_conf["value"] is cpn._compact_messages.await_args.args[2]
    assert output == ["answer"]


@pytest.mark.p1
def test_normal_output_compacts_once_across_retries():
    cpn = _llm()
    cpn._id = "llm"
    cpn.chat_mdl = SimpleNamespace(max_length=1000)
    cpn._canvas = SimpleNamespace(get_component=lambda _component_id: None)
    cpn._prepare_prompt_variables = MagicMock(return_value=("system", [{"role": "user", "content": "query"}], {}))
    cpn._get_chat_template_kwargs = lambda: {}
    compacted = [{"role": "user", "content": "compacted"}]
    cpn._compact_messages = AsyncMock(return_value=compacted)
    cpn.fit_messages = MagicMock(
        side_effect=lambda system, _messages, _max_length: (
            [
                {"role": "system", "content": system},
                {"role": "user", "content": "compacted"},
            ],
            None,
        )
    )
    cpn._generate_async = AsyncMock(side_effect=["**ERROR**: retry", "ok"])
    cpn.check_if_canceled = lambda _message="": False
    cpn.set_output = MagicMock()
    cpn._param.max_retries = 1

    asyncio.run(cpn._invoke_async())

    cpn._compact_messages.assert_awaited_once()
    assert compacted == [{"role": "user", "content": "compacted"}]
    compact_gen_conf = cpn._compact_messages.await_args.args[2]
    assert cpn.fit_messages.call_count == 2
    assert cpn.fit_messages.call_args.args[1] == compacted
    assert all(call.kwargs["gen_conf"] is compact_gen_conf for call in cpn._generate_async.await_args_list)
    assert cpn.set_output.call_args_list[-1].args == ("content", "ok")


@pytest.mark.p1
def test_structured_output_compacts_once_across_json_retries(monkeypatch):
    cpn = _llm()
    cpn._id = "llm"
    cpn.chat_mdl = SimpleNamespace(max_length=1000)
    cpn._param.outputs = {"structured": {"properties": {"answer": {"type": "string"}}}}
    cpn._param.max_retries = 1
    cpn._prepare_prompt_variables = MagicMock(return_value=("system", [{"role": "user", "content": "query"}], {}))
    cpn._get_chat_template_kwargs = lambda: {}
    compacted = [{"role": "user", "content": "compacted"}]
    cpn._compact_messages = AsyncMock(return_value=compacted)
    cpn.fit_messages = MagicMock(
        side_effect=lambda system, _messages, _max_length: (
            [
                {"role": "system", "content": system},
                {"role": "user", "content": "compacted"},
            ],
            None,
        )
    )
    cpn._generate_async = AsyncMock(side_effect=["invalid-json", '{"answer": "ok"}'])
    monkeypatch.setattr(
        "agent.component.llm.json_repair.loads",
        MagicMock(side_effect=[ValueError("invalid json"), {"answer": "ok"}]),
    )
    cpn.check_if_canceled = lambda _message="": False
    cpn.set_output = MagicMock()

    asyncio.run(cpn._invoke_async())

    cpn._compact_messages.assert_awaited_once()
    assert compacted == [{"role": "user", "content": "compacted"}]
    assert cpn.fit_messages.call_count == 2
    assert all(call.args[1] == compacted for call in cpn.fit_messages.call_args_list)
    assert cpn.set_output.call_args.args[0] == "structured"


@pytest.mark.p1
def test_stream_output_stops_when_compaction_cancels():
    cpn = _llm()
    cpn.imgs = []
    cpn.chat_mdl = SimpleNamespace(max_length=1000)
    cpn._get_chat_template_kwargs = lambda: {}
    cpn._compact_messages = AsyncMock(return_value=[{"role": "user", "content": "compacted"}])
    cpn.fit_messages = MagicMock()
    cpn.chat_mdl.async_chat_streamly_delta = MagicMock()
    cpn.check_if_canceled = MagicMock(return_value=True)
    cpn.set_output = MagicMock()

    async def collect():
        return [value async for value in cpn._stream_output_async("system", [{"role": "user", "content": "query"}])]

    assert asyncio.run(collect()) == []
    cpn.fit_messages.assert_not_called()
    cpn.chat_mdl.async_chat_streamly_delta.assert_not_called()
