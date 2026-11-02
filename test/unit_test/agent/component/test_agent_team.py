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

import asyncio
import json

import pytest

from agent.component.agent_team import AgentTeam, AgentTeamParam, DelegateTaskTool, DelegateTaskToolParam
from agent.component.agent_team import MANAGER_DELEGATION_PROMPT
from agent.delegation import DelegationBudget, TeamTaskSpec, WorkerRegistry, WorkerSpec, delegation_scope
from agent.tools.base import LLMToolPluginCallSession


class _Canvas:
    def __init__(self):
        self.task_id = "task"

    def is_canceled(self):
        return False


def _worker() -> dict:
    return {
        "id": "researcher",
        "name": "Research Specialist",
        "role": "research",
        "capabilities": ["web_search"],
        "description": "Finds evidence on the public web.",
        "agent": {"llm_id": "test-model"},
    }


def _tool() -> DelegateTaskTool:
    param = DelegateTaskToolParam()
    param.workers = [_worker()]
    param.manager_id = "manager"
    param.max_delegations = 2
    param.max_depth = 2
    param.worker_timeout = 5

    tool = DelegateTaskTool.__new__(DelegateTaskTool)
    tool._canvas = _Canvas()
    tool._id = "manager-->delegate_task"
    tool._param = param
    tool._registry = WorkerRegistry(param.workers, manager_id=param.manager_id)
    tool._budget = DelegationBudget(param.max_delegations)
    tool._delegations = []
    return tool


def test_delegate_task_metadata_hides_internal_worker_configuration():
    tool = _tool()

    meta = tool.get_meta()

    properties = meta["function"]["parameters"]["properties"]
    assert set(properties) == {"worker", "task", "context", "expected_output"}
    assert "web_search" in meta["function"]["description"]


def test_delegate_task_resolves_capability_and_returns_observation():
    tool = _tool()

    async def fake_run(worker: WorkerSpec, *, task: str, context: str, expected_output: str) -> str:
        assert worker.id == "researcher"
        assert task == "Find primary sources"
        assert context == "The answer needs citations."
        assert expected_output == "A source list"
        return "source-a\nsource-b"

    tool._run_worker = fake_run
    response = asyncio.run(
        tool._invoke_async(
            worker="web_search",
            task="Find primary sources",
            context="The answer needs citations.",
            expected_output="A source list",
        )
    )

    payload = json.loads(response)
    assert payload["status"] == "ok"
    assert payload["worker_id"] == "researcher"
    assert payload["result"] == "source-a\nsource-b"
    assert tool.delegations[0]["status"] == "ok"


def test_delegate_task_passes_reasoning_context_and_expected_output_to_worker(monkeypatch):
    tool = _tool()
    captured = {}

    class FakeWorkerAgent:
        async def _invoke_async(self, **kwargs):
            captured.update(kwargs)

        def error(self):
            return None

        def output(self, key):
            return "worker result" if key == "content" else None

    monkeypatch.setattr(tool, "_build_worker_agent", lambda _worker: FakeWorkerAgent())

    result = asyncio.run(
        tool._run_worker(
            tool._registry.resolve("researcher"),
            task="Find primary sources",
            context="Facts already collected.",
            expected_output="A source list",
        )
    )

    assert result == "worker result"
    assert captured["user_prompt"] == "Find primary sources"
    assert "researcher" in captured["reasoning"]
    assert captured["context"] == "Facts already collected.\n\nEXPECTED OUTPUT:\nA source list"


def test_delegate_task_runs_through_llm_tool_session():
    tool = _tool()
    callbacks = []

    async def fake_run(worker: WorkerSpec, *, task: str, context: str, expected_output: str) -> str:
        assert worker.id == "researcher"
        return "session result"

    tool._run_worker = fake_run
    session = LLMToolPluginCallSession(
        {"delegate_task_0": tool},
        lambda *args, **kwargs: callbacks.append((args, kwargs)),
    )

    response = asyncio.run(
        session.tool_call_async(
            "delegate_task_0",
            {
                "worker": "researcher",
                "task": "Find primary sources",
                "context": "Facts already collected.",
                "expected_output": "A source list",
            },
        )
    )

    payload = json.loads(response)
    assert payload["status"] == "ok"
    assert payload["result"] == "session result"
    assert len(callbacks) == 1


def test_delegate_task_worker_failure_is_returned_as_observation():
    tool = _tool()

    async def failed_run(*_args, **_kwargs) -> str:
        raise RuntimeError("worker unavailable")

    tool._run_worker = failed_run
    response = asyncio.run(
        tool._invoke_async(
            worker="research",
            task="Find primary sources",
            context="",
            expected_output="A source list",
        )
    )

    payload = json.loads(response)
    assert payload["status"] == "error"
    assert "worker unavailable" in payload["error"]
    assert tool.delegations[0]["status"] == "error"


def test_delegate_task_empty_worker_content_is_returned_as_observation(monkeypatch):
    tool = _tool()

    class EmptyWorkerAgent:
        async def _invoke_async(self, **_kwargs):
            return None

        def error(self):
            return None

        def output(self, key):
            return "" if key == "content" else None

    monkeypatch.setattr(tool, "_build_worker_agent", lambda _worker: EmptyWorkerAgent())

    response = asyncio.run(
        tool._invoke_async(
            worker="researcher",
            task="Find primary sources",
            context="",
            expected_output="A source list",
        )
    )

    payload = json.loads(response)
    assert payload["status"] == "error"
    assert "returned no content" in payload["error"]
    assert tool.delegations[0]["status"] == "error"


def test_delegate_task_returns_budget_error_as_observation():
    tool = _tool()

    async def fake_run(*_args, **_kwargs) -> str:
        return "result"

    tool._run_worker = fake_run
    for _ in range(tool._param.max_delegations):
        asyncio.run(tool._invoke_async(worker="researcher", task="task", context="", expected_output="result"))

    response = asyncio.run(tool._invoke_async(worker="researcher", task="task", context="", expected_output="result"))

    payload = json.loads(response)
    assert payload["status"] == "error"
    assert "max_delegations" in payload["error"]
    assert tool.delegations[-1]["status"] == "error"


def test_delegate_task_rejects_delegation_beyond_max_depth():
    tool = _tool()
    invoked = False

    async def fake_run(*_args, **_kwargs) -> str:
        nonlocal invoked
        invoked = True
        return "result"

    tool._run_worker = fake_run
    with delegation_scope(max_depth=tool._param.max_depth):
        with delegation_scope(max_depth=tool._param.max_depth):
            response = asyncio.run(tool._invoke_async(worker="researcher", task="task", context="", expected_output="result"))

    payload = json.loads(response)
    assert payload["status"] == "error"
    assert "max_depth" in payload["error"]
    assert invoked is False


def test_delegate_task_reset_clears_budget_and_history():
    tool = _tool()

    async def fake_run(*_args, **_kwargs) -> str:
        return "result"

    tool._run_worker = fake_run
    asyncio.run(tool._invoke_async(worker="researcher", task="task", context="", expected_output="result"))
    assert tool._budget.used == 1

    tool.reset()

    assert tool._budget.used == 0
    assert tool.delegations == []
    response = asyncio.run(tool._invoke_async(worker="researcher", task="task", context="", expected_output="result"))
    assert json.loads(response)["status"] == "ok"


def test_agent_team_param_validates_manager_and_workers():
    param = AgentTeamParam()
    param.manager = {"params": {"llm_id": "manager-model"}}
    param.workers = [_worker()]
    param.max_delegations = 2
    param.max_depth = 2
    param.worker_timeout = 5

    assert param.check() is True


def test_agent_team_registered_as_component():
    from agent.component import component_class

    assert component_class("AgentTeam") is not None
    assert component_class("AgentTeamParam") is not None


def test_delegate_task_propagates_custom_header_to_worker(monkeypatch):
    import agent.component as component_package

    captured = {}

    class FakeAgentParam:
        def update(self, conf):
            captured.update(conf)

        def check(self):
            return True

    class FakeAgent:
        def __init__(self, _canvas, _id, param):
            self.param = param

    def fake_component_class(name):
        return {"AgentParam": FakeAgentParam, "Agent": FakeAgent}[name]

    monkeypatch.setattr(component_package, "component_class", fake_component_class)
    tool = _tool()
    tool._param.custom_header = {"X-Tenant": "tenant-a"}

    tool._build_worker_agent(tool._registry.resolve("researcher"))

    assert captured["custom_header"] == {"X-Tenant": "tenant-a"}


def test_agent_team_injects_delegate_task_into_manager(monkeypatch):
    import agent.component as component_package

    captured = {}

    class FakeAgentParam:
        def __init__(self):
            self.conf = {}

        def update(self, conf):
            self.conf.update(conf)
            captured.update(conf)

        def check(self):
            return True

    class FakeDelegate(DelegateTaskTool):
        pass

    class FakeAgent:
        def __init__(self, _canvas, _id, param):
            delegate = object.__new__(FakeDelegate)
            delegate._param = DelegateTaskToolParam()
            delegate._param.update(param.conf["tools"][-1]["params"])
            self.tools = {"delegate_task_0": delegate}

    def fake_component_class(name):
        return {"AgentParam": FakeAgentParam, "Agent": FakeAgent}[name]

    monkeypatch.setattr(component_package, "component_class", fake_component_class)
    team = AgentTeam.__new__(AgentTeam)
    team._canvas = _Canvas()
    team._id = "team"
    team._param = AgentTeamParam()
    team._param.manager = {"params": {"llm_id": "manager-model", "tools": []}}
    team._param.workers = [_worker()]
    team._param.max_delegations = 2
    team._param.max_depth = 2
    team._param.worker_timeout = 5
    team._param.custom_header = {"X-Tenant": "tenant-a"}

    manager, delegate = team._build_manager_agent()

    tool_config = captured["tools"][-1]
    assert tool_config["component_name"] == "DelegateTask"
    assert tool_config["params"]["manager_id"] == "team"
    assert captured["custom_header"] == {"X-Tenant": "tenant-a"}
    assert manager is team._manager_agent
    assert delegate is team._delegate_tool


def test_delegate_task_handles_missing_custom_header(monkeypatch):
    import agent.component as component_package

    captured = {}

    class FakeAgentParam:
        def update(self, conf):
            captured.update(conf)

        def check(self):
            return True

    class FakeAgent:
        def __init__(self, _canvas, _id, _param):
            pass

    def fake_component_class(name):
        return {"AgentParam": FakeAgentParam, "Agent": FakeAgent}[name]

    monkeypatch.setattr(component_package, "component_class", fake_component_class)
    tool = _tool()
    tool._param.custom_header = None

    tool._build_worker_agent(tool._registry.resolve("researcher"))

    assert captured["custom_header"] == {}


def test_agent_team_writes_manager_result_and_delegation_trace():
    class FakeDelegate:
        def __init__(self):
            self.delegations = []
            self.reset_count = 0

        def reset(self, only_output=False):
            self.reset_count += 1
            self.delegations = []

    class FakeManager:
        def __init__(self, delegate):
            self.delegate = delegate
            self._outputs = {}

        async def _invoke_async(self, **kwargs):
            self.delegate.delegations = [{"sequence": 1, "worker_id": "researcher", "status": "ok"}]
            self._outputs["content"] = "final answer"
            self._outputs["structured"] = {"answer": "final answer"}

        def error(self):
            return None

        def output(self, key=None):
            return self._outputs if key is None else self._outputs.get(key)

    team = AgentTeam.__new__(AgentTeam)
    team._param = AgentTeamParam()
    team._param.outputs = {}
    team._manager_agent = None
    team._delegate_tool = None
    delegate = FakeDelegate()
    manager = FakeManager(delegate)
    team._build_manager_agent = lambda: (manager, delegate)

    result = asyncio.run(team._invoke_async(user_prompt="question"))

    assert result == "final answer"
    assert team.output("content") == "final answer"
    assert team.output("structured") == {"answer": "final answer"}
    assert team.output("delegations") == [{"sequence": 1, "worker_id": "researcher", "status": "ok"}]
    assert delegate.reset_count == 1


def test_agent_team_reset_clears_outputs_and_runtime_agents():
    class FakeDelegate:
        def reset(self, only_output=False):
            pass

    class FakeManager:
        def __init__(self):
            self.reset_count = 0

        def reset(self, only_output=False):
            self.reset_count += 1

    team = AgentTeam.__new__(AgentTeam)
    team._param = AgentTeamParam()
    team._param.outputs = {"content": {"value": "old answer"}}
    team._param.inputs = {"user_prompt": {"value": "old prompt"}}
    manager = FakeManager()
    team._manager_agent = manager
    team._delegate_tool = FakeDelegate()

    team.reset()

    assert team.output("content") is None
    assert team.get_input_value("user_prompt") is None
    assert team._manager_agent is None
    assert team._delegate_tool is None
    assert manager.reset_count == 1


def test_agent_team_param_defaults_to_hierarchical_process():
    param = AgentTeamParam()

    assert param.process == "hierarchical"


def test_agent_team_param_accepts_sequential_process_without_manager():
    param = AgentTeamParam()
    param.process = "sequential"
    param.manager = {}
    param.workers = [_worker()]
    param.tasks = [
        {
            "worker": "researcher",
            "task": "Find primary sources",
            "expected_output": "A source list",
        }
    ]
    param.max_delegations = 2
    param.max_depth = 2
    param.worker_timeout = 5

    assert param.check() is True


def test_agent_team_param_rejects_unknown_process():
    param = AgentTeamParam()
    param.process = "unknown"
    param.manager = {"params": {"llm_id": "manager-model"}}
    param.workers = [_worker()]
    param.max_delegations = 2
    param.max_depth = 2
    param.worker_timeout = 5

    with pytest.raises(ValueError, match="process"):
        param.check()


def test_agent_team_param_rejects_manager_in_sequential_process():
    param = AgentTeamParam()
    param.process = "sequential"
    param.manager = {"params": {"llm_id": "manager-model"}}
    param.workers = [_worker()]
    param.tasks = [{"worker": "researcher", "task": "first", "expected_output": "one"}]
    param.max_delegations = 1
    param.max_depth = 2
    param.worker_timeout = 5

    with pytest.raises(ValueError, match="Manager"):
        param.check()


def test_agent_team_param_rejects_tasks_in_hierarchical_process():
    param = AgentTeamParam()
    param.process = "hierarchical"
    param.manager = {"params": {"llm_id": "manager-model"}}
    param.workers = [_worker()]
    param.tasks = [{"worker": "researcher", "task": "first", "expected_output": "one"}]
    param.max_delegations = 1
    param.max_depth = 2
    param.worker_timeout = 5

    with pytest.raises(ValueError, match="Tasks"):
        param.check()


def test_agent_team_param_rejects_more_sequential_tasks_than_budget():
    param = AgentTeamParam()
    param.process = "sequential"
    param.manager = {}
    param.workers = [_worker()]
    param.tasks = [
        {"worker": "researcher", "task": "first", "expected_output": "one"},
        {"worker": "researcher", "task": "second", "expected_output": "two"},
    ]
    param.max_delegations = 1
    param.max_depth = 2
    param.worker_timeout = 5

    with pytest.raises(ValueError, match="max_delegations"):
        param.check()


def _sequential_team(tasks: list[dict]) -> AgentTeam:
    team = AgentTeam.__new__(AgentTeam)
    team._canvas = _Canvas()
    team._id = "team"
    team._param = AgentTeamParam()
    team._param.process = "sequential"
    team._param.manager = {}
    team._param.workers = [_worker()]
    team._param.tasks = tasks
    team._param.max_delegations = len(tasks)
    team._param.max_depth = 2
    team._param.worker_timeout = 5
    team._param.outputs = {}
    team._param.inputs = {}
    team._registry = WorkerRegistry(team._param.workers)
    team._budget = DelegationBudget(team._param.max_delegations)
    team._delegations = []
    team._manager_agent = None
    team._delegate_tool = None
    return team


def test_sequential_process_chains_task_outputs_in_declared_order():
    team = _sequential_team(
        [
            {
                "worker": "researcher",
                "task": "Collect primary sources",
                "context": "Keep every source link.",
                "expected_output": "A source list",
            },
            {
                "worker": "researcher",
                "task": "Write the final report",
                "context": "Use a concise technical style.",
                "expected_output": "A final report",
            },
        ]
    )
    calls = []

    async def fake_run(worker: WorkerSpec, *, task: str, context: str, expected_output: str) -> str:
        calls.append(
            {
                "worker_id": worker.id,
                "task": task,
                "context": context,
                "expected_output": expected_output,
            }
        )
        return "draft sources" if len(calls) == 1 else "final report"

    team._run_worker = fake_run

    result = asyncio.run(team._invoke_async(user_prompt="Research the topic"))

    assert result == "final report"
    assert [call["task"] for call in calls] == ["Collect primary sources", "Write the final report"]
    assert "Research the topic" in calls[0]["context"]
    assert "Keep every source link." in calls[0]["context"]
    assert "draft sources" in calls[1]["context"]
    assert team.output("content") == "final report"
    assert [item["status"] for item in team.output("delegations")] == ["ok", "ok"]


def test_sequential_process_stops_on_worker_failure():
    team = _sequential_team(
        [
            {"worker": "researcher", "task": "first", "expected_output": "one"},
            {"worker": "researcher", "task": "second", "expected_output": "two"},
        ]
    )
    calls = []

    async def fail(*_args, **_kwargs) -> str:
        calls.append(1)
        raise RuntimeError("worker unavailable")

    team._run_worker = fail

    result = asyncio.run(team._invoke_async(user_prompt="Research the topic"))

    assert result is None
    assert len(calls) == 1
    assert "worker unavailable" in team.output("_ERROR")
    assert team.output("delegations")[0]["status"] == "error"


def test_sequential_process_records_runtime_budget_error():
    team = _sequential_team(
        [
            {"worker": "researcher", "task": "first", "expected_output": "one"},
            {"worker": "researcher", "task": "second", "expected_output": "two"},
        ]
    )
    team._budget = DelegationBudget(1)

    async def succeed(*_args, **_kwargs) -> str:
        return "first result"

    team._run_worker = succeed

    result = asyncio.run(team._invoke_async(user_prompt="Research the topic"))

    assert result is None
    assert "max_delegations" in team.output("_ERROR")
    assert team.output("delegations")[-1]["status"] == "error"
    assert team.output("delegations")[-1]["sequence"] == 0


@pytest.mark.parametrize(
    ("process", "rounds", "judge", "budget"),
    [
        ("parallel", 1, "", 1),
        ("vote", 1, "researcher", 2),
        ("debate", 2, "researcher", 3),
        ("consensus", 2, "", 2),
    ],
)
def test_agent_team_param_validates_collaboration_processes(process, rounds, judge, budget):
    param = AgentTeamParam()
    param.process = process
    param.manager = {}
    param.workers = [_worker()]
    param.tasks = [{"worker": "researcher", "task": "review", "expected_output": "a decision"}]
    param.max_concurrency = 2
    param.collaboration_rounds = rounds
    param.judge = judge
    param.max_delegations = budget
    param.max_depth = 2
    param.worker_timeout = 5

    assert param.check() is True


def test_agent_team_param_rejects_insufficient_collaboration_budget():
    param = AgentTeamParam()
    param.process = "debate"
    param.manager = {}
    param.workers = [_worker()]
    param.tasks = [{"worker": "researcher", "task": "debate", "expected_output": "a position"}]
    param.collaboration_rounds = 3
    param.max_delegations = 2
    param.max_depth = 2
    param.worker_timeout = 5

    with pytest.raises(ValueError, match="max_delegations"):
        param.check()


def test_agent_team_param_rejects_invalid_concurrency():
    param = AgentTeamParam()
    param.process = "parallel"
    param.manager = {}
    param.workers = [_worker()]
    param.tasks = [{"worker": "researcher", "task": "work", "expected_output": "result"}]
    param.max_concurrency = 0
    param.max_delegations = 1
    param.max_depth = 2
    param.worker_timeout = 5

    with pytest.raises(ValueError, match="max_concurrency"):
        param.check()


def test_agent_team_injects_manager_delegation_prompt_without_overwriting_custom_prompt(monkeypatch):
    import agent.component as component_package

    captured = {}

    class FakeAgentParam:
        def update(self, conf):
            captured.update(conf)

        def check(self):
            return True

    class FakeAgent:
        def __init__(self, _canvas, _id, _param):
            self.tools = {}

    def fake_component_class(name):
        return {"AgentParam": FakeAgentParam, "Agent": FakeAgent}[name]

    monkeypatch.setattr(component_package, "component_class", fake_component_class)
    team = AgentTeam.__new__(AgentTeam)
    team._canvas = _Canvas()
    team._id = "team"
    team._param = AgentTeamParam()
    team._param.manager = {
        "params": {
            "llm_id": "manager-model",
            "sys_prompt": "CUSTOM MANAGER RULE",
        }
    }
    team._param.workers = [_worker()]
    team._param.max_delegations = 2
    team._param.max_depth = 2
    team._param.worker_timeout = 5

    with pytest.raises(RuntimeError, match="failed to attach DelegateTask"):
        team._build_manager_agent()

    assert MANAGER_DELEGATION_PROMPT in captured["sys_prompt"]
    assert "CUSTOM MANAGER RULE" in captured["sys_prompt"]


def _collaboration_team(process: str, tasks: list[dict], *, budget: int = 20, concurrency: int = 2, rounds: int = 2, judge: str = ""):
    team = AgentTeam.__new__(AgentTeam)
    team._canvas = _Canvas()
    team._id = "team"
    team._param = AgentTeamParam()
    team._param.process = process
    team._param.manager = {}
    team._param.workers = [_worker()]
    team._param.tasks = tasks
    team._param.max_concurrency = concurrency
    team._param.collaboration_rounds = rounds
    team._param.judge = judge
    team._param.max_delegations = budget
    team._param.max_depth = 2
    team._param.worker_timeout = 5
    team._param.outputs = {}
    team._param.inputs = {}
    team._registry = WorkerRegistry(team._param.workers)
    team._budget = DelegationBudget(budget)
    team._delegations = []
    team._manager_agent = None
    team._delegate_tool = None
    return team


def test_run_task_batch_obeys_max_concurrency_and_keeps_task_order():
    tasks = [{"worker": "researcher", "task": f"task {index}", "expected_output": "result"} for index in range(4)]
    team = _collaboration_team("parallel", tasks, concurrency=2)
    active = 0
    max_active = 0

    async def fake_run(worker, *, task, context, expected_output):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.02)
        active -= 1
        return task

    team._run_worker = fake_run
    resolved = [TeamTaskSpec.from_mapping(task, team._registry, index) for index, task in enumerate(tasks)]

    results = asyncio.run(team._run_task_batch(resolved, process="parallel", round_index=1, previous_context=""))

    assert max_active == 2
    assert [result["task_index"] for result in results] == [0, 1, 2, 3]
    assert [result["content"] for result in results] == ["task 0", "task 1", "task 2", "task 3"]
    assert len(team._delegations) == 4


def test_run_task_batch_keeps_success_when_one_worker_fails():
    tasks = [
        {"worker": "researcher", "task": "fail", "expected_output": "result"},
        {"worker": "researcher", "task": "succeed", "expected_output": "result"},
    ]
    team = _collaboration_team("parallel", tasks)
    resolved = [TeamTaskSpec.from_mapping(task, team._registry, index) for index, task in enumerate(tasks)]

    async def fake_run(_worker, *, task, context, expected_output):
        if task == "fail":
            raise RuntimeError("worker unavailable")
        return "survived"

    team._run_worker = fake_run
    results = asyncio.run(team._run_task_batch(resolved, process="parallel", round_index=1, previous_context=""))

    assert results[0]["status"] == "error"
    assert "worker unavailable" in results[0]["error"]
    assert results[1]["status"] == "ok"
    assert results[1]["content"] == "survived"
    assert [record.status for record in team._delegations] == ["error", "ok"]


def test_parallel_process_returns_partial_results():
    tasks = [
        {"worker": "researcher", "task": "first", "expected_output": "result"},
        {"worker": "researcher", "task": "second", "expected_output": "result"},
    ]
    team = _collaboration_team("parallel", tasks)

    async def fake_batch(_tasks, **_kwargs):
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": "first result", "result": "first result", "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "error", "content": "", "result": "", "error": "failed"},
        ]

    team._run_task_batch = fake_batch
    content = asyncio.run(team._invoke_async(user_prompt="compare options"))
    payload = json.loads(content)

    assert payload["status"] == "partial"
    assert payload["results"][0]["result"] == "first result"
    assert payload["results"][1]["status"] == "error"
    assert team.output("winner") is None
    assert team.output("votes") == []


def test_vote_process_selects_unique_count_winner():
    tasks = [{"worker": "researcher", "task": f"review {index}", "expected_output": "vote"} for index in range(3)]
    team = _collaboration_team("vote", tasks, budget=3)

    async def fake_batch(_tasks, **_kwargs):
        choices = [("approve", 0.2), ("approve", 0.1), ("reject", 0.9)]
        return [
            {
                "task_index": index,
                "worker_id": "researcher",
                "status": "ok",
                "content": json.dumps({"choice": choice, "confidence": confidence}),
                "result": json.dumps({"choice": choice, "confidence": confidence}),
                "error": "",
            }
            for index, (choice, confidence) in enumerate(choices)
        ]

    team._run_task_batch = fake_batch
    content = asyncio.run(team._invoke_async(user_prompt="decide"))
    payload = json.loads(content)

    assert payload["winner"] == "approve"
    assert payload["tie_break"] == "count"
    assert len(team.output("votes")) == 3
    assert team.output("winner") == "approve"


def test_vote_process_uses_confidence_tie_break():
    tasks = [{"worker": "researcher", "task": f"review {index}", "expected_output": "vote"} for index in range(4)]
    team = _collaboration_team("vote", tasks, budget=4)
    votes = [("approve", 0.2), ("approve", 0.2), ("reject", 0.9), ("reject", 0.9)]

    async def fake_batch(_tasks, **_kwargs):
        return [
            {
                "task_index": index,
                "worker_id": "researcher",
                "status": "ok",
                "content": json.dumps({"choice": choice, "confidence": confidence}),
                "result": json.dumps({"choice": choice, "confidence": confidence}),
                "error": "",
            }
            for index, (choice, confidence) in enumerate(votes)
        ]

    team._run_task_batch = fake_batch
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="decide")))

    assert payload["winner"] == "reject"
    assert payload["tie_break"] == "confidence"


def test_vote_process_uses_judge_for_equal_count_and_confidence():
    tasks = [
        {"worker": "researcher", "task": "review a", "expected_output": "vote"},
        {"worker": "researcher", "task": "review b", "expected_output": "vote"},
    ]
    team = _collaboration_team("vote", tasks, budget=3, judge="researcher")

    async def fake_batch(_tasks, **_kwargs):
        return [
            {
                "task_index": 0,
                "worker_id": "researcher",
                "status": "ok",
                "content": '{"choice": "approve", "confidence": 0.5}',
                "result": '{"choice": "approve", "confidence": 0.5}',
                "error": "",
            },
            {
                "task_index": 1,
                "worker_id": "researcher",
                "status": "ok",
                "content": '{"choice": "reject", "confidence": 0.5}',
                "result": '{"choice": "reject", "confidence": 0.5}',
                "error": "",
            },
        ]

    async def fake_judge(**_kwargs):
        return {"status": "ok", "content": '{"choice": "reject", "rationale": "lower risk"}', "error": ""}

    team._run_task_batch = fake_batch
    team._run_judge = fake_judge
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="decide")))

    assert payload["winner"] == "reject"
    assert payload["tie_break"] == "judge"
    assert "lower risk" in payload["judge_result"]


def test_vote_process_leaves_unresolved_tie_without_judge():
    tasks = [
        {"worker": "researcher", "task": "review a", "expected_output": "vote"},
        {"worker": "researcher", "task": "review b", "expected_output": "vote"},
    ]
    team = _collaboration_team("vote", tasks, budget=2)

    async def fake_batch(_tasks, **_kwargs):
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve", "confidence": 1}', "result": '{"choice": "approve", "confidence": 1}', "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "ok", "content": '{"choice": "reject", "confidence": 1}', "result": '{"choice": "reject", "confidence": 1}', "error": ""},
        ]

    team._run_task_batch = fake_batch
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="decide")))

    assert payload["winner"] is None
    assert payload["tie_break"] == "none"


def test_debate_process_injects_other_participant_views_in_later_rounds():
    tasks = [
        {"worker": "researcher", "task": "task 0", "expected_output": "argument"},
        {"worker": "researcher", "task": "task 1", "expected_output": "argument"},
    ]
    team = _collaboration_team("debate", tasks, budget=4, rounds=2)
    contexts = []

    async def fake_run(_worker, *, task, context, expected_output):
        contexts.append((task, context))
        return f"view from {task}"

    team._run_worker = fake_run
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="debate proposal")))

    round_two = {task: context for task, context in contexts if "PREVIOUS ROUND" in context}
    assert len(payload["rounds"]) == 2
    assert payload["winner"] is None
    assert "view from task 1" in round_two["task 0"]
    assert "view from task 0" not in round_two["task 0"]
    assert "view from task 0" in round_two["task 1"]
    assert "view from task 1" not in round_two["task 1"]


def test_debate_process_falls_back_to_last_round_when_judge_fails():
    tasks = [
        {"worker": "researcher", "task": "task 0", "expected_output": "argument"},
        {"worker": "researcher", "task": "task 1", "expected_output": "argument"},
    ]
    team = _collaboration_team("debate", tasks, budget=3, rounds=1, judge="researcher")

    async def fake_batch(_tasks, **_kwargs):
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": "view 0", "result": "view 0", "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "ok", "content": "view 1", "result": "view 1", "error": ""},
        ]

    async def failed_judge(**_kwargs):
        return {"status": "error", "content": "", "error": "judge unavailable"}

    team._run_task_batch = fake_batch
    team._run_judge = failed_judge
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="debate proposal")))

    assert "view 0" in payload["summary"]
    assert "view 1" in payload["summary"]
    assert payload["winner"] is None


def test_consensus_process_stops_early_when_all_votes_match():
    tasks = [
        {"worker": "researcher", "task": "vote 0", "expected_output": "vote"},
        {"worker": "researcher", "task": "vote 1", "expected_output": "vote"},
    ]
    team = _collaboration_team("consensus", tasks, budget=6, rounds=3)
    calls = []

    async def fake_batch(_tasks, **kwargs):
        calls.append(kwargs["round_index"])
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve", "confidence": 0.8}', "result": "", "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve", "confidence": 0.7}', "result": "", "error": ""},
        ]

    team._run_task_batch = fake_batch
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="reach consensus")))

    assert calls == [1]
    assert payload["consensus"] is True
    assert payload["winner"] == "approve"
    assert payload["resolution"] == "consensus"


def test_consensus_process_uses_judge_after_rounds_exhausted():
    tasks = [
        {"worker": "researcher", "task": "vote 0", "expected_output": "vote"},
        {"worker": "researcher", "task": "vote 1", "expected_output": "vote"},
    ]
    team = _collaboration_team("consensus", tasks, budget=3, rounds=1, judge="researcher")

    async def fake_batch(_tasks, **_kwargs):
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve", "confidence": 0.5}', "result": "", "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "ok", "content": '{"choice": "reject", "confidence": 0.5}', "result": "", "error": ""},
        ]

    async def fake_judge(**_kwargs):
        return {"status": "ok", "content": '{"choice": "reject"}', "error": ""}

    team._run_task_batch = fake_batch
    team._run_judge = fake_judge
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="reach consensus")))

    assert payload["consensus"] is False
    assert payload["winner"] == "reject"
    assert payload["resolution"] == "judge"


def test_consensus_process_falls_back_to_final_round_vote_without_judge():
    tasks = [
        {"worker": "researcher", "task": "vote 0", "expected_output": "vote"},
        {"worker": "researcher", "task": "vote 1", "expected_output": "vote"},
        {"worker": "researcher", "task": "vote 2", "expected_output": "vote"},
    ]
    team = _collaboration_team("consensus", tasks, budget=3, rounds=1)

    async def fake_batch(_tasks, **_kwargs):
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve"}', "result": "", "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve"}', "result": "", "error": ""},
            {"task_index": 2, "worker_id": "researcher", "status": "ok", "content": '{"choice": "reject"}', "result": "", "error": ""},
        ]

    team._run_task_batch = fake_batch
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="reach consensus")))

    assert payload["consensus"] is False
    assert payload["winner"] == "approve"
    assert payload["resolution"] == "vote"


def test_consensus_process_leaves_vote_tie_unresolved():
    tasks = [
        {"worker": "researcher", "task": "vote 0", "expected_output": "vote"},
        {"worker": "researcher", "task": "vote 1", "expected_output": "vote"},
    ]
    team = _collaboration_team("consensus", tasks, budget=2, rounds=1)

    async def fake_batch(_tasks, **_kwargs):
        return [
            {"task_index": 0, "worker_id": "researcher", "status": "ok", "content": '{"choice": "approve", "confidence": 1}', "result": "", "error": ""},
            {"task_index": 1, "worker_id": "researcher", "status": "ok", "content": '{"choice": "reject", "confidence": 1}', "result": "", "error": ""},
        ]

    team._run_task_batch = fake_batch
    payload = json.loads(asyncio.run(team._invoke_async(user_prompt="reach consensus")))

    assert payload["winner"] is None
    assert payload["resolution"] == "vote"
