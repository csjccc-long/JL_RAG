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

import asyncio
import json
import logging
import re
import time
from copy import deepcopy
from collections.abc import Mapping, Sequence
from typing import Any

from agent.component.base import ComponentBase, ComponentParamBase
from agent.collaboration import (
    DEBATE_JUDGE_INSTRUCTION,
    JUDGE_OUTPUT_INSTRUCTION,
    VOTE_OUTPUT_INSTRUCTION,
    build_previous_round_context,
    consensus_choice,
    parse_judge,
    parse_vote,
    summarize_responses,
    tally_votes,
)
from agent.delegation import (
    DelegationBudget,
    DelegationError,
    DelegationRecord,
    HIERARCHICAL_PROCESS,
    SEQUENTIAL_PROCESS,
    CONSENSUS_PROCESS,
    DEBATE_PROCESS,
    PARALLEL_PROCESS,
    VOTE_PROCESS,
    AGENT_TEAM_PROCESSES,
    TeamTaskSpec,
    WorkerRegistry,
    WorkerSpec,
    delegation_scope,
)

from agent.team_progress import record_finish, record_start, reset_progress
from agent.tools.base import ToolBase, ToolParamBase
"""
AgentTeamParam 定义了这个组件的配置面，支持多个流程模式：

SEQUENTIAL_PROCESS：按顺序执行任务，前一步输出作为下一步输入
PARALLEL_PROCESS：多个 worker 同时处理一组任务
VOTE_PROCESS：让多个 worker 投票，汇总结果
DEBATE_PROCESS：多个 worker 互相辩论并形成结论
CONSENSUS_PROCESS：不断迭代直到形成共识
HIERARCHICAL_PROCESS：让 manager Agent 通过工具去分派任务
这说明这个组件不是单一逻辑，而是一个统一的多 Agent 协作框架。

真正的执行入口在 AgentTeam._invoke_async()，它根据 process 分派到不同函数执行：_invoke_sequential_async()、_invoke_parallel_async()、_invoke_vote_async()、_invoke_debate_async()、_invoke_consensus_async()、_invoke_hierarchical_async()。
这些方法都遵循同一种结构：运行 worker → 收集结果 → 汇总输出 → 记录审计日志 → 写回 content / structured / delegations 等字段。

这个模块还调用了 collaboration.py 里的解析工具，用于处理投票与裁决的结构化输出。
例如 parse_vote()、parse_judge()、tally_votes()、consensus_choice()、summarize_responses() 这些函数，负责把模型返回的自然语言转成结构化投票信息，再做结果汇总与决策。这使它能够支持“LLM 之间协作决策”的真实工作流，而不是只做单轮调用。

最后，reset() 会清理 manager 和预算状态，避免状态残留。
整个设计非常强调“可控性”：任务不只要能执行，还要有预算、深度限制、执行记录、错误回溯能力。
"""
_logger = logging.getLogger(__name__)


MANAGER_DELEGATION_PROMPT = """You manage a team of registered specialist agents.
Follow any caller-provided manager instructions; they take precedence when more specific.
1. Decompose the request only when a specialist can add material value. When the
   request names several angles, perspectives, or deliverables, delegate each one
   to a distinct worker before you answer.
2. Select a worker from the available roster by id, role, or capability.
3. Call the delegation tool exposed in your tool schema. Its function name may carry an index suffix.
   Provide a self-contained task, relevant context, and concrete expected_output.
4. Review each Observation before deciding whether to delegate again or answer.
5. If a worker fails, choose another worker, narrow the task, or continue with available evidence.
6. Synthesize the final answer yourself. Do not concatenate worker responses or invent missing evidence."""


# manager 漏填 expected_output 时的兜底期望，保证 worker 至少拿到一个明确的产出要求。
DEFAULT_EXPECTED_OUTPUT = "A concise, directly usable answer to the task."


def _agent_params_from_spec(spec: Mapping[str, Any], *, component: str) -> dict[str, Any]:
    if not isinstance(spec, Mapping):
        raise ValueError(f"[{component}] Agent configuration must be an object")
    raw = spec.get("params") if isinstance(spec.get("params"), Mapping) else spec
    params = deepcopy(dict(raw))
    if not params:
        raise ValueError(f"[{component}] Agent configuration can not be empty")
    return params


def _agent_text_from_spec(spec: Mapping[str, Any]) -> str:
    params = _agent_params_from_spec(spec, component="AgentTeam")
    texts = [str(params.get("sys_prompt") or "")]
    prompts = params.get("prompts") or []
    if isinstance(prompts, str):
        texts.append(prompts)
    elif isinstance(prompts, list):
        for prompt in prompts:
            if isinstance(prompt, Mapping):
                texts.append(str(prompt.get("content") or ""))
    return "\n".join(texts)


def _manager_prompt(manager_params: Mapping[str, Any]) -> str:
    custom_prompt = str(manager_params.get("sys_prompt") or "").strip()
    if not custom_prompt:
        return MANAGER_DELEGATION_PROMPT
    return f"{custom_prompt}\n\n{MANAGER_DELEGATION_PROMPT}"


def _custom_header_dict(value: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    return deepcopy(dict(value))


def _create_worker_agent(canvas, owner_id: str, custom_header: Mapping[str, Any] | None, worker: WorkerSpec):
    from agent.component import component_class

    agent_config = deepcopy(dict(worker.agent_config))
    team_header = _custom_header_dict(custom_header)
    worker_header = agent_config.get("custom_header")
    agent_config["custom_header"] = _custom_header_dict(worker_header) if isinstance(worker_header, Mapping) else team_header
    param = component_class("AgentParam")()
    param.update(agent_config)
    param.check()
    suffix = re.sub(r"[^A-Za-z0-9_.-]+", "_", worker.id).strip("_") or "worker"
    return component_class("Agent")(canvas, f"{owner_id}-->worker_{suffix}", param)


def _require_worker_content(worker_id: str, result: Any) -> str:
    content = "" if result is None else str(result)
    if not content.strip():
        raise DelegationError(f"worker {worker_id!r} returned no content")
    return content


async def _execute_worker_agent(
    canvas,
    owner_id: str,
    custom_header: Mapping[str, Any],
    worker: WorkerSpec,
    *,
    task: str,
    context: str,
    expected_output: str,
    reasoning: str,
    worker_agent=None,
) -> str:
    if worker_agent is None:
        worker_agent = _create_worker_agent(canvas, owner_id, custom_header, worker)
    worker_context = context
    if worker_context:
        worker_context += "\n\n"
    worker_context += f"EXPECTED OUTPUT:\n{expected_output}"
    await worker_agent._invoke_async(
        user_prompt=task,
        reasoning=reasoning,
        context=worker_context,
    )
    if worker_agent.error():
        raise DelegationError(str(worker_agent.error()))
    result = worker_agent.output("content")
    return _require_worker_content(worker.id, result)


def _build_sequential_context(*, user_prompt: str, runtime_context: str, task_context: str, previous_output: str) -> str:
    parts = []
    if user_prompt:
        parts.append(f"ORIGINAL REQUEST:\n{user_prompt}")
    if runtime_context:
        parts.append(f"RUNTIME CONTEXT:\n{runtime_context}")
    if task_context:
        parts.append(f"TASK CONTEXT:\n{task_context}")
    if previous_output:
        parts.append(f"PRIOR TASK OUTPUT:\n{previous_output}")
    return "\n\n".join(parts)


def _build_collaboration_context(*, user_prompt: str, runtime_context: str, task_context: str, previous_context: str) -> str:
    parts = []
    if user_prompt:
        parts.append(f"ORIGINAL REQUEST:\n{user_prompt}")
    if runtime_context:
        parts.append(f"RUNTIME CONTEXT:\n{runtime_context}")
    if task_context:
        parts.append(f"TASK CONTEXT:\n{task_context}")
    if previous_context:
        parts.append(previous_context)
    return "\n\n".join(parts)


def _resolve_team_tasks(registry: WorkerRegistry, tasks: Any, process: str) -> tuple[TeamTaskSpec, ...]:
    if not isinstance(tasks, list) or not tasks:
        raise DelegationError(f"{process} process requires a non-empty tasks list")
    return tuple(TeamTaskSpec.from_mapping(task, registry, index) for index, task in enumerate(tasks))


def _required_delegations(process: str, task_count: int, rounds: int, has_judge: bool) -> int:
    if process == PARALLEL_PROCESS:
        return task_count
    if process == VOTE_PROCESS:
        return task_count + int(has_judge)
    if process in (DEBATE_PROCESS, CONSENSUS_PROCESS):
        return task_count * rounds + int(has_judge)
    return task_count


class DelegateTaskParam(ToolParamBase):
    # 命名必须严格是 <component_name>Param：Agent._load_tool_obj() 通过
    # component_class(cpn["component_name"] + "Param") 反射加载工具，名字不符会
    # 直接 assert False: Can't import DelegateTaskParam，hierarchical 团队整条链路不可用。
    def __init__(self):
        self.meta = {
            "name": "delegate_task",
            "description": "Delegate a bounded task to a registered specialist and wait for its result.",
            "parameters": {
                "worker": {
                    "type": "string",
                    "description": "Worker id, role, or capability selected from the available worker roster.",
                    "required": True,
                },
                "task": {
                    "type": "string",
                    "description": "A self-contained task for the worker.",
                    "required": True,
                },
                "context": {
                    "type": "string",
                    "description": "Facts, constraints, and prior decisions the worker needs.",
                    "required": True,
                },
                "expected_output": {
                    "type": "string",
                    "description": "The concrete result or format the worker must return.",
                    "required": True,
                },
            },
        }
        super().__init__()
        self.function_name = "delegate_task"
        self.workers = []
        self.manager_id = ""
        self.max_delegations = 8
        self.max_depth = 3
        self.worker_timeout = 300
        self.custom_header = {}
        # 小模型常把多个角度的任务全派给同一个成员，导致团队只剩一个人说话。
        # 开启后：若选中的成员已经接过活、而还有成员一次都没被用过，就自动改派
        # 给闲置成员（结果里带 metadata.reassigned_from，便于追溯）。
        self.prefer_unused_workers = True

    def check(self):
        self.check_empty(self.workers, "[DelegateTask] Workers")
        WorkerRegistry(self.workers, manager_id=self.manager_id)
        self.check_defined_type(self.max_delegations, "[DelegateTask] Max delegations", ["int"])
        self.check_defined_type(self.max_depth, "[DelegateTask] Max depth", ["int"])
        if self.max_delegations < 1:
            raise ValueError("[DelegateTask] Max delegations must be at least 1")
        if self.max_depth < 1:
            raise ValueError("[DelegateTask] Max depth must be at least 1")
        if not isinstance(self.worker_timeout, (int, float)) or self.worker_timeout <= 0:
            raise ValueError("[DelegateTask] Worker timeout must be positive")
        if not isinstance(self.prefer_unused_workers, bool):
            raise ValueError("[DelegateTask] Prefer unused workers must be a boolean")
        return True


class DelegateTask(ToolBase):
    component_name = "DelegateTask"

    def __init__(self, canvas, component_id, param: DelegateTaskParam):
        super().__init__(canvas, component_id, param)
        self._registry = WorkerRegistry(param.workers, manager_id=param.manager_id)
        self._budget = DelegationBudget(param.max_delegations)
        self._delegations: list[DelegationRecord] = []
        # manager 可能在同一轮里并发发起多个 delegate_task（qwen2.5:3b 就会把
        # 三个角度一次全发出去）。只看已完成的 _delegations 会让三个请求都
        # 认领同一个成员，所以这里额外记下"已认领"的成员 id。
        self._claimed_workers: set[str] = set()
        # 由 AgentTeam 注入：让每次分派都能写进所属团队的运行看板。
        self.team_task_id = ""
        self.team_component_id = ""

    @property
    def delegations(self) -> list[dict[str, Any]]:
        return [record.as_dict() for record in self._delegations]

    def get_meta(self) -> dict[str, Any]:
        meta = super().get_meta()
        roster = self._registry.describe()
        if roster:
            meta["function"]["description"] += "\n\nAvailable workers:\n" + roster
        return meta

    def _invoke(self, **kwargs):
        return asyncio.run(self._invoke_async(**kwargs))

    async def _invoke_async(self, **kwargs):
        selector = str(kwargs.get("worker") or "").strip()
        task = str(kwargs.get("task") or "").strip()
        context = str(kwargs.get("context") or "").strip()
        expected_output = str(kwargs.get("expected_output") or "").strip()
        if not task:
            return self._error_observation(selector, task, context, expected_output, "task can not be empty")
        # 小模型（qwen2.5:3b 这类）经常只填 task 漏填 expected_output，
        # 直接拒绝会让整次 hierarchical 运行零分派，这里退化成通用期望。
        expected_output = expected_output or DEFAULT_EXPECTED_OUTPUT

        sequence = 0
        worker_id = selector
        entry_id = ""
        started = time.perf_counter()
        try:
            worker = self._registry.resolve(selector)
            worker, reassigned_from = self._prefer_unused_worker(worker)
            worker_id = worker.id
            sequence = self._budget.claim()
            entry_id = self._progress_start(worker, task=task, context=context, sequence=sequence)
            with delegation_scope(self._param.max_depth):
                result = await asyncio.wait_for(
                    self._run_worker(
                        worker,
                        task=task,
                        context=context,
                        expected_output=expected_output,
                    ),
                    timeout=self._param.worker_timeout,
                )
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            result_text = _require_worker_content(worker.id, result)
            self._delegations.append(
                DelegationRecord(
                    sequence=sequence,
                    worker_id=worker.id,
                    task=task,
                    context=context,
                    expected_output=expected_output,
                    status="ok",
                    result=result_text,
                    duration_ms=elapsed_ms,
                    # 与其它五种策略保持同一套 metadata：分发看板靠 round/task_index
                    # 排序并和"待分发"任务去重，缺字段会落到 round=0、task_index=index。
                    metadata={
                        "process": HIERARCHICAL_PROCESS,
                        "round": 1,
                        "task_index": max(sequence - 1, 0),
                        "role": worker.role or "participant",
                        **({"reassigned_from": reassigned_from} if reassigned_from else {}),
                    },
                )
            )
            self._progress_finish(entry_id, status="ok", result=result_text, elapsed_ms=elapsed_ms)
            self.set_output("delegations", self.delegations)
            return json.dumps(
                {
                    "status": "ok",
                    "sequence": sequence,
                    "worker_id": worker.id,
                    "role": worker.role,
                    "result": result_text,
                },
                ensure_ascii=False,
            )
        except asyncio.CancelledError:
            # 会话被用户中止时 CancelledError 不是 Exception，若不在这里收尾，
            # 分发看板会把这条记录一直显示成"分发中"。
            self._progress_finish(
                entry_id,
                status="error",
                error="cancelled",
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
            raise
        except Exception as exc:
            if not isinstance(exc, DelegationError):
                _logger.exception("[DelegateTask] worker %s failed", worker_id)
            self._progress_finish(
                entry_id,
                status="error",
                error=str(exc),
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
            return self._error_observation(
                selector,
                task,
                context,
                expected_output,
                str(exc),
                worker_id=worker_id,
                sequence=sequence,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )

    def _prefer_unused_worker(self, worker: WorkerSpec) -> tuple[WorkerSpec, str]:
        """把重复派给同一成员的后续任务改派给还没被用过的成员。

        3B 级别的 manager 经常把"财务/合规/技术三个角度"三次都派给同一个
        worker，表面上派了 3 单，实际团队里只有一个成员在工作。这里只做
        "同一成员已被用过 + 仍有闲置成员"时的改派，不影响 manager 正常的分工。
        """
        claimed = getattr(self, "_claimed_workers", None)
        if claimed is None:
            claimed = set()
            self._claimed_workers = claimed
        if not getattr(self._param, "prefer_unused_workers", True):
            claimed.add(worker.id)
            return worker, ""
        used = {record.worker_id for record in self._delegations} | claimed
        if worker.id not in used:
            claimed.add(worker.id)
            return worker, ""
        for candidate in self._registry.workers:
            if candidate.id not in used:
                claimed.add(candidate.id)
                return candidate, worker.id
        claimed.add(worker.id)
        return worker, ""

    async def _run_worker(self, worker: WorkerSpec, *, task: str, context: str, expected_output: str) -> str:
        return await _execute_worker_agent(
            self._canvas,
            self._id,
            self._param.custom_header,
            worker,
            task=task,
            context=context,
            expected_output=expected_output,
            reasoning=f"Manager selected worker {worker.id} for this task.",
            worker_agent=self._build_worker_agent(worker),
        )

    def _progress_start(self, worker: WorkerSpec, *, task: str, context: str, sequence: int) -> str:
        task_id = getattr(self, "team_task_id", "")
        if not task_id:
            return ""
        return record_start(
            task_id,
            component_id=self.team_component_id,
            worker_id=worker.id,
            worker_name=worker.name or worker.id,
            role=worker.role or "participant",
            task=task,
            context=context,
            process=HIERARCHICAL_PROCESS,
            round_index=1,
            task_index=max(sequence - 1, 0),
            sequence=sequence,
        )

    def _progress_finish(self, entry_id: str, *, status: str, result: str = "", error: str = "", elapsed_ms: int = 0) -> None:
        task_id = getattr(self, "team_task_id", "")
        if not entry_id or not task_id:
            return
        record_finish(task_id, entry_id, status=status, result=result, error=error, elapsed_ms=elapsed_ms)

    def _build_worker_agent(self, worker: WorkerSpec):
        return _create_worker_agent(self._canvas, self._id, self._param.custom_header, worker)

    def _error_observation(
        self,
        selector: str,
        task: str,
        context: str,
        expected_output: str,
        error: str,
        *,
        worker_id: str = "",
        sequence: int = 0,
        duration_ms: int = 0,
    ) -> str:
        # sequence 为 0 表示这次调用没有真正派出 worker（参数校验失败、worker
        # 解析失败、预算用尽），不写进 delegations，否则看板会出现"从未分发"的
        # 红色卡片。
        if not sequence:
            return json.dumps(
                {
                    "status": "error",
                    "sequence": sequence,
                    "worker_id": worker_id or selector,
                    "error": error,
                },
                ensure_ascii=False,
            )
        self._delegations.append(
            DelegationRecord(
                sequence=sequence,
                worker_id=worker_id or selector,
                task=task,
                context=context,
                expected_output=expected_output,
                status="error",
                error=error,
                duration_ms=duration_ms,
                metadata={
                    "process": HIERARCHICAL_PROCESS,
                    "round": 1,
                    "task_index": max(sequence - 1, 0),
                    "role": "participant",
                },
            )
        )
        self.set_output("delegations", self.delegations)
        return json.dumps(
            {
                "status": "error",
                "sequence": sequence,
                "worker_id": worker_id or selector,
                "error": error,
            },
            ensure_ascii=False,
        )

    def reset(self, only_output=False):
        super().reset(only_output)
        self._budget.reset()
        self._delegations = []
        self._claimed_workers = set()


class AgentTeamParam(ComponentParamBase):
    def __init__(self):
        super().__init__()
        self.process = HIERARCHICAL_PROCESS
        self.manager = {}
        self.workers = []
        self.tasks = []
        self.max_concurrency = 4
        self.collaboration_rounds = 3
        self.judge = ""
        self.max_delegations = 8
        self.max_depth = 3
        self.worker_timeout = 300
        self.custom_header = {}

    def check(self):
        if self.process not in AGENT_TEAM_PROCESSES:
            raise ValueError(f"[AgentTeam] process {self.process!r} must be one of {sorted(AGENT_TEAM_PROCESSES)}")
        if not isinstance(self.workers, list) or not self.workers:
            raise ValueError("[AgentTeam] Workers can not be empty")
        registry = WorkerRegistry(self.workers)
        self.check_defined_type(self.max_delegations, "[AgentTeam] Max delegations", ["int"])
        self.check_defined_type(self.max_depth, "[AgentTeam] Max depth", ["int"])
        if self.max_delegations < 1:
            raise ValueError("[AgentTeam] Max delegations must be at least 1")
        if self.max_depth < 1:
            raise ValueError("[AgentTeam] Max depth must be at least 1")
        if not isinstance(self.worker_timeout, (int, float)) or self.worker_timeout <= 0:
            raise ValueError("[AgentTeam] Worker timeout must be positive")
        if not isinstance(self.max_concurrency, int) or isinstance(self.max_concurrency, bool) or self.max_concurrency < 1:
            raise ValueError("[AgentTeam] max_concurrency must be a positive integer")
        if not isinstance(self.collaboration_rounds, int) or isinstance(self.collaboration_rounds, bool) or self.collaboration_rounds < 1:
            raise ValueError("[AgentTeam] collaboration_rounds must be a positive integer")
        if not isinstance(self.judge, str):
            raise ValueError("[AgentTeam] judge must be a worker selector string")

        if self.process == HIERARCHICAL_PROCESS:
            _agent_params_from_spec(self.manager, component="AgentTeam")
            if self.tasks:
                raise ValueError("[AgentTeam] Tasks are not supported by the hierarchical process")
            if self.judge.strip():
                raise ValueError("[AgentTeam] judge is not supported by the hierarchical process")
            return True

        if self.manager:
            raise ValueError(f"[AgentTeam] Manager is not supported by the {self.process} process")
        team_tasks = _resolve_team_tasks(registry, self.tasks, self.process)
        judge = self.judge.strip()
        if judge:
            if self.process not in (VOTE_PROCESS, DEBATE_PROCESS, CONSENSUS_PROCESS):
                raise ValueError(f"[AgentTeam] judge is not supported by the {self.process} process")
            registry.resolve(judge)
        required = _required_delegations(self.process, len(team_tasks), self.collaboration_rounds, bool(judge))
        if required > self.max_delegations:
            raise ValueError(f"[AgentTeam] max_delegations must be at least {required} for the {self.process} process")
        return True


class AgentTeam(ComponentBase):
    component_name = "AgentTeam"

    def __init__(self, canvas, component_id, param: AgentTeamParam):
        super().__init__(canvas, component_id, param)
        self._registry = WorkerRegistry(param.workers)
        self._budget = DelegationBudget(param.max_delegations)
        self._delegations: list[DelegationRecord] = []
        self._manager_agent = None
        self._delegate_tool = None

    def get_input_elements(self) -> dict[str, Any]:
        if self._param.process != HIERARCHICAL_PROCESS:
            texts = []
            for task in self._param.tasks:
                if isinstance(task, Mapping):
                    texts.extend(str(task.get(key) or "") for key in ("task", "context", "expected_output"))
            for worker in self._param.workers:
                try:
                    texts.append(_agent_text_from_spec(WorkerSpec.from_mapping(worker).agent_config))
                except (DelegationError, ValueError, TypeError):
                    continue
            return self.get_input_elements_from_text("\n".join(texts))
        return self.get_input_elements_from_text(_agent_text_from_spec(self._param.manager))

    def _invoke(self, **kwargs):
        return asyncio.run(self._invoke_async(**kwargs))

    def thoughts(self) -> str:
        # Canvas 在每个节点 node_started 时都会调用 thoughts()，ComponentBase 的默认
        # 实现是 raise NotImplementedError，缺这个方法会直接中断整张画布的运行。
        workers = len(self._param.workers) if isinstance(self._param.workers, list) else 0
        tasks = len(self._param.tasks) if isinstance(self._param.tasks, list) else 0
        if self._param.process == HIERARCHICAL_PROCESS:
            return f"Managing {workers} worker(s) and deciding who to delegate to next."
        return f"Dispatching {tasks} task(s) to {workers} worker(s) with the {self._param.process} process."

    @property
    def _progress_task_id(self) -> str:
        # 进度通道是旁路：缺 canvas（单测里直接 __new__ 出来的实例）或 canvas
        # 没有 task_id 时返回空串，由 team_progress 自行跳过，绝不打断团队运行。
        return str(getattr(getattr(self, "_canvas", None), "task_id", "") or "")

    def _start_progress(self, *, worker, task: str, process: str, round_index: int, task_index: int, role: str = "participant", context: str = "", sequence: int = 0) -> str:
        return record_start(
            self._progress_task_id,
            component_id=self._id,
            worker_id=worker.id,
            worker_name=worker.name or worker.id,
            role=role,
            task=task,
            context=context,
            process=process,
            round_index=round_index,
            task_index=task_index,
            sequence=sequence,
        )

    def _finish_progress(self, entry_id: str, *, status: str, result: str = "", error: str = "", elapsed_ms: int = 0) -> None:
        record_finish(self._progress_task_id, entry_id, status=status, result=result, error=error, elapsed_ms=elapsed_ms)

    async def _invoke_async(self, **kwargs):
        # ComponentBase.invoke_async 先把 _created_time 写进 outputs，再调用本方法。
        # 清空 outputs 时若把 _created_time 一并清掉，收尾计算 _elapsed_time 会抛
        # TypeError: unsupported operand type(s) for -: 'float' and 'NoneType'，
        # 整张画布随之崩溃，所以这里必须保留计时字段。
        created_time = self.output("_created_time")
        self.reset(only_output=True)
        if created_time is not None:
            self.set_output("_created_time", created_time)
        reset_progress(self._progress_task_id)
        if self._param.process == SEQUENTIAL_PROCESS:
            return await self._invoke_sequential_async(**kwargs)
        if self._param.process == PARALLEL_PROCESS:
            return await self._invoke_parallel_async(**kwargs)
        if self._param.process == VOTE_PROCESS:
            return await self._invoke_vote_async(**kwargs)
        if self._param.process == DEBATE_PROCESS:
            return await self._invoke_debate_async(**kwargs)
        if self._param.process == CONSENSUS_PROCESS:
            return await self._invoke_consensus_async(**kwargs)
        return await self._invoke_hierarchical_async(**kwargs)

    async def _invoke_hierarchical_async(self, **kwargs):
        manager, delegate_tool = self._build_manager_agent()
        delegate_tool.reset()
        await manager._invoke_async(**kwargs)
        if manager.error():
            self.set_output("_ERROR", manager.error())
            return
        if not delegate_tool.delegations:
            # 小参数模型经常"只描述计划、不调用工具"，看起来像跑完了，实际上一个
            # 子任务都没派出去（看板全空）。这里用一次显式指令重试，把"必须调用
            # delegate_task"写进这一轮的 query 里。
            manager.reset(only_output=True)
            delegate_tool.reset()
            nudge = dict(kwargs)
            nudge["user_prompt"] = (
                str(kwargs.get("user_prompt") or "").strip()
                + "\n\nIMPORTANT: You have not delegated any work yet. You MUST call the "
                "delegate_task tool now, one call per specialist, before producing the final "
                "answer. Do not answer with a plan or a description of what you would do."
            )
            await manager._invoke_async(**nudge)
            if manager.error():
                self.set_output("_ERROR", manager.error())
                return
        self.set_output("delegations", delegate_tool.delegations)
        content = manager.output("content")
        structured = manager.output("structured")
        if structured is not None or "structured" in manager.output():
            self.set_output("structured", structured)
        self.set_output("content", content)
        if not delegate_tool.delegations:
            # 重试后仍然没有委派：退化为"直接把请求分发给每个成员并汇总"，用户至少
            # 能看到任务确实分发到了成员手里，而不是主管自说自话。
            return await self._hierarchical_direct_dispatch(**kwargs)
        self._flag_hierarchical_coverage(structured, delegate_tool.delegations)
        return content

    def _flag_hierarchical_coverage(self, structured, delegations) -> None:
        # 小模型主管常常只派一个成员就收尾，用户看到的是"三个角度只答了一个"。
        # 这里不改写主管的答复，只把覆盖情况标出来，让看板显示"部分完成 + 未分派成员"。
        registry = getattr(self, "_registry", None)
        if registry is None:
            return
        workers = registry.workers
        delegated = {
            record.worker_id if hasattr(record, "worker_id") else record.get("worker_id", "")
            for record in delegations
        }
        missing = [worker.name or worker.id for worker in workers if worker.id not in delegated]
        if not missing:
            return
        payload = dict(structured) if isinstance(structured, Mapping) else {}
        payload["status"] = "partial"
        payload["warning"] = (
            f"The manager dispatched {len(delegated)} of {len(workers)} workers; "
            f"not delegated: {', '.join(missing)}."
        )
        self.set_output("structured", payload)

    async def _hierarchical_direct_dispatch(self, **kwargs):
        user_prompt = str(kwargs.get("user_prompt") or "").strip()
        runtime_context = str(kwargs.get("context") or "").strip()
        try:
            if self._param.tasks:
                tasks = _resolve_team_tasks(self._registry, self._param.tasks, HIERARCHICAL_PROCESS)
            else:
                tasks = tuple(
                    TeamTaskSpec(
                        index=index,
                        worker=worker,
                        task=user_prompt,
                        context="",
                        expected_output=DEFAULT_EXPECTED_OUTPUT,
                    )
                    for index, worker in enumerate(self._registry.workers)
                )
        except Exception as exc:
            self.set_output("_ERROR", str(exc))
            return

        results = await self._run_task_batch(
            tasks,
            process=HIERARCHICAL_PROCESS,
            round_index=1,
            previous_context="",
            user_prompt=user_prompt,
            runtime_context=runtime_context,
        )
        succeeded = sum(result["status"] == "ok" for result in results)
        status = "ok" if succeeded == len(results) else "partial" if succeeded else "error"
        if not succeeded:
            self.set_output("_ERROR", "hierarchical process produced no successful worker output")
        payload = {
            "process": HIERARCHICAL_PROCESS,
            "status": status,
            "manager_fallback": True,
            "warning": "The manager did not delegate; the request was dispatched to every worker directly.",
            "results": [
                {
                    "task_index": result["task_index"],
                    "worker_id": result["worker_id"],
                    "status": result["status"],
                    "result": result["content"],
                    "error": result["error"],
                }
                for result in results
            ],
            "votes": [],
            "rounds": [{"round": 1, "responses": results}],
            "consensus": False,
            "winner": None,
        }
        return self._write_collaboration_output(payload)

    def _write_collaboration_output(self, payload: dict[str, Any]) -> str:
        content = json.dumps(payload, ensure_ascii=False)
        self.set_output("content", content)
        self.set_output("structured", payload)
        self.set_output("delegations", [record.as_dict() for record in self._delegations])
        self.set_output("votes", payload.get("votes", []))
        self.set_output("rounds", payload.get("rounds", []))
        self.set_output("consensus", bool(payload.get("consensus", False)))
        self.set_output("winner", payload.get("winner"))
        return content

    async def _invoke_parallel_async(self, **kwargs):
        try:
            tasks = _resolve_team_tasks(self._registry, self._param.tasks, self._param.process)
        except Exception as exc:
            self.set_output("_ERROR", str(exc))
            return

        results = await self._run_task_batch(
            tasks,
            process=PARALLEL_PROCESS,
            round_index=1,
            previous_context="",
            user_prompt=str(kwargs.get("user_prompt") or "").strip(),
            runtime_context=str(kwargs.get("context") or "").strip(),
        )
        succeeded = sum(result["status"] == "ok" for result in results)
        status = "ok" if succeeded == len(results) else "partial" if succeeded else "error"
        if not succeeded:
            self.set_output("_ERROR", "parallel process produced no successful worker output")
        payload = {
            "process": PARALLEL_PROCESS,
            "status": status,
            "results": [
                {
                    "task_index": result["task_index"],
                    "worker_id": result["worker_id"],
                    "status": result["status"],
                    "result": result["content"],
                    "error": result["error"],
                }
                for result in results
            ],
            "votes": [],
            "rounds": [{"round": 1, "responses": results}],
            "consensus": False,
            "winner": None,
        }
        return self._write_collaboration_output(payload)

    @staticmethod
    def _votes_from_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        votes = []
        for result in results:
            vote = parse_vote(result["task_index"], result["worker_id"], result["content"])
            if result["status"] != "ok":
                vote["status"] = "invalid"
                vote["choice"] = ""
                vote["error"] = result["error"]
            votes.append(vote)
        return votes

    async def _invoke_vote_async(self, **kwargs):
        try:
            tasks = _resolve_team_tasks(self._registry, self._param.tasks, self._param.process)
        except Exception as exc:
            self.set_output("_ERROR", str(exc))
            return

        user_prompt = str(kwargs.get("user_prompt") or "").strip()
        runtime_context = str(kwargs.get("context") or "").strip()
        results = await self._run_task_batch(
            tasks,
            process=VOTE_PROCESS,
            round_index=1,
            previous_context="",
            user_prompt=user_prompt,
            runtime_context=runtime_context,
            expected_output_instruction=VOTE_OUTPUT_INSTRUCTION,
        )
        votes = self._votes_from_results(results)
        tally = tally_votes(votes)
        winner = tally["winner"]
        tie_break = tally["tie_break"]
        judge_result = ""
        if not winner and tally["tied"] and self._param.judge.strip():
            judge = await self._run_judge(
                process=VOTE_PROCESS,
                round_index=1,
                task="Resolve the tied vote by selecting one candidate.",
                context=json.dumps({"votes": votes, "candidates": tally["tied"]}, ensure_ascii=False),
                expected_output=JUDGE_OUTPUT_INSTRUCTION,
            )
            judge_result = judge["content"] if judge["status"] == "ok" else judge["error"]
            decision = parse_judge(judge["content"], tally["tied"]) if judge["status"] == "ok" else parse_judge("", [])
            if decision["status"] == "valid":
                winner = decision["choice"]
                tie_break = "judge"

        if not any(vote["status"] == "valid" for vote in votes):
            self.set_output("_ERROR", "vote process produced no valid votes")
        payload = {
            "process": VOTE_PROCESS,
            "winner": winner or None,
            "votes": votes,
            "rounds": [{"round": 1, "responses": results}],
            "consensus": False,
            "tie_break": tie_break,
            "judge_result": judge_result,
        }
        return self._write_collaboration_output(payload)

    async def _invoke_debate_async(self, **kwargs):
        try:
            tasks = _resolve_team_tasks(self._registry, self._param.tasks, self._param.process)
        except Exception as exc:
            self.set_output("_ERROR", str(exc))
            return

        user_prompt = str(kwargs.get("user_prompt") or "").strip()
        runtime_context = str(kwargs.get("context") or "").strip()
        rounds = []
        previous_responses = None
        last_responses = []
        for round_index in range(1, self._param.collaboration_rounds + 1):
            results = await self._run_task_batch(
                tasks,
                process=DEBATE_PROCESS,
                round_index=round_index,
                previous_context="",
                previous_responses=previous_responses,
                user_prompt=user_prompt,
                runtime_context=runtime_context,
                expected_output_instruction=("Respond with a concise argument. Address the other participants' views without inventing evidence."),
            )
            rounds.append({"round": round_index, "responses": results})
            if not any(result["status"] == "ok" for result in results):
                self.set_output("_ERROR", "debate process produced no successful worker output")
                break
            previous_responses = results
            last_responses = results

        summary = summarize_responses(last_responses)
        judge_result = ""
        if last_responses and self._param.judge.strip():
            judge = await self._run_judge(
                process=DEBATE_PROCESS,
                round_index=len(rounds),
                task=DEBATE_JUDGE_INSTRUCTION,
                context=summary,
                expected_output="Return a concise synthesis and conclusion.",
            )
            if judge["status"] == "ok":
                summary = judge["content"]
            else:
                judge_result = judge["error"]

        payload = {
            "process": DEBATE_PROCESS,
            "winner": None,
            "summary": summary,
            "rounds": rounds,
            "votes": [],
            "consensus": False,
            "judge_result": judge_result,
        }
        return self._write_collaboration_output(payload)

    async def _invoke_consensus_async(self, **kwargs):
        try:
            tasks = _resolve_team_tasks(self._registry, self._param.tasks, self._param.process)
        except Exception as exc:
            self.set_output("_ERROR", str(exc))
            return

        user_prompt = str(kwargs.get("user_prompt") or "").strip()
        runtime_context = str(kwargs.get("context") or "").strip()
        rounds = []
        previous_responses = None
        latest_votes = []
        consensus = ""
        for round_index in range(1, self._param.collaboration_rounds + 1):
            results = await self._run_task_batch(
                tasks,
                process=CONSENSUS_PROCESS,
                round_index=round_index,
                previous_context="",
                previous_responses=previous_responses,
                user_prompt=user_prompt,
                runtime_context=runtime_context,
                expected_output_instruction=VOTE_OUTPUT_INSTRUCTION,
            )
            latest_votes = self._votes_from_results(results)
            rounds.append({"round": round_index, "responses": results})
            consensus = consensus_choice(latest_votes, len(tasks))
            if consensus:
                break
            if not any(result["status"] == "ok" for result in results):
                self.set_output("_ERROR", "consensus process produced no successful worker output")
                break
            previous_responses = results

        winner = consensus
        resolution = "consensus" if consensus else "none"
        judge_result = ""
        valid_choices = list(dict.fromkeys(vote["choice"] for vote in latest_votes if vote["status"] == "valid"))
        if not consensus and valid_choices and self._param.judge.strip():
            judge = await self._run_judge(
                process=CONSENSUS_PROCESS,
                round_index=len(rounds),
                task="Resolve the unresolved consensus discussion by selecting one candidate.",
                context=json.dumps({"votes": latest_votes, "candidates": valid_choices}, ensure_ascii=False),
                expected_output=JUDGE_OUTPUT_INSTRUCTION,
            )
            judge_result = judge["content"] if judge["status"] == "ok" else judge["error"]
            if judge["status"] == "ok":
                decision = parse_judge(judge["content"], valid_choices)
                if decision["status"] == "valid":
                    winner = decision["choice"]
                    resolution = "judge"
        elif not consensus and valid_choices:
            tally = tally_votes(latest_votes)
            winner = tally["winner"]
            resolution = "vote"

        if not valid_choices:
            self.set_output("_ERROR", "consensus process produced no valid votes")
        payload = {
            "process": CONSENSUS_PROCESS,
            "consensus": bool(consensus),
            "winner": winner or None,
            "votes": latest_votes,
            "rounds": rounds,
            "resolution": resolution,
            "judge_result": judge_result,
        }
        return self._write_collaboration_output(payload)

    async def _invoke_sequential_async(self, **kwargs):
        try:
            tasks = _resolve_team_tasks(self._registry, self._param.tasks, self._param.process)
        except Exception as exc:
            self.set_output("_ERROR", str(exc))
            return

        user_prompt = str(kwargs.get("user_prompt") or "").strip()
        runtime_context = str(kwargs.get("context") or "").strip()
        previous_output = ""

        for task in tasks:
            context = _build_sequential_context(
                user_prompt=user_prompt,
                runtime_context=runtime_context,
                task_context=task.context,
                previous_output=previous_output,
            )
            started = time.perf_counter()
            try:
                sequence = self._budget.claim()
            except DelegationError as exc:
                # 预算用尽属于"没有派出去"，不该在看板上留下一张卡片。
                self.set_output("_ERROR", str(exc))
                return
            # 顺序执行同样要把每一步写进进度通道，否则分发看板对 sequential
            # 完全没有卡片可显示（PROGRESS N 0）。
            entry_id = self._start_progress(
                worker=task.worker,
                task=task.task,
                process=SEQUENTIAL_PROCESS,
                round_index=1,
                task_index=task.index,
                context=context,
                sequence=sequence,
            )
            try:
                with delegation_scope(self._param.max_depth):
                    result = await asyncio.wait_for(
                        self._run_worker(
                            task.worker,
                            task=task.task,
                            context=context,
                            expected_output=task.expected_output,
                        ),
                        timeout=self._param.worker_timeout,
                    )
                result_text = _require_worker_content(task.worker.id, result)
            except asyncio.CancelledError:
                # 中止运行时 CancelledError 不是 Exception，不在这里收尾，看板上的
                # 卡片会永远停在"分发中"。
                self._finish_progress(
                    entry_id,
                    status="error",
                    error="cancelled",
                    elapsed_ms=int((time.perf_counter() - started) * 1000),
                )
                raise
            except Exception as exc:
                if not isinstance(exc, DelegationError):
                    _logger.exception("[AgentTeam] sequential worker %s failed", task.worker.id)
                error = str(exc)
                self._finish_progress(
                    entry_id,
                    status="error",
                    error=error,
                    elapsed_ms=int((time.perf_counter() - started) * 1000),
                )
                self._delegations.append(
                    DelegationRecord(
                        sequence=sequence,
                        worker_id=task.worker.id,
                        task=task.task,
                        context=context,
                        expected_output=task.expected_output,
                        status="error",
                        error=error,
                        duration_ms=int((time.perf_counter() - started) * 1000),
                        metadata={"process": SEQUENTIAL_PROCESS, "round": 1, "task_index": task.index},
                    )
                )
                self.set_output("delegations", [record.as_dict() for record in self._delegations])
                self.set_output("_ERROR", error)
                return

            duration_ms = int((time.perf_counter() - started) * 1000)
            self._delegations.append(
                DelegationRecord(
                    sequence=sequence,
                    worker_id=task.worker.id,
                    task=task.task,
                    context=context,
                    expected_output=task.expected_output,
                    status="ok",
                    result=result_text,
                    duration_ms=duration_ms,
                    metadata={"process": SEQUENTIAL_PROCESS, "round": 1, "task_index": task.index},
                )
            )
            self._finish_progress(entry_id, status="ok", result=result_text, elapsed_ms=duration_ms)
            self.set_output("delegations", [record.as_dict() for record in self._delegations])
            previous_output = result_text

        self.set_output("content", previous_output)
        return previous_output

    async def _run_task_batch(
        self,
        tasks: tuple[TeamTaskSpec, ...],
        *,
        process: str,
        round_index: int,
        previous_context: str,
        previous_responses: Sequence[Mapping[str, Any]] | None = None,
        user_prompt: str = "",
        runtime_context: str = "",
        expected_output_instruction: str = "",
    ) -> list[dict[str, Any]]:
        semaphore = asyncio.Semaphore(self._param.max_concurrency)

        async def run(task: TeamTaskSpec) -> dict[str, Any]:
            task_previous_context = previous_context
            if previous_responses is not None:
                task_previous_context = build_previous_round_context(previous_responses, task.index)
            async with semaphore:
                return await self._run_task(
                    task,
                    process=process,
                    round_index=round_index,
                    previous_context=task_previous_context,
                    user_prompt=user_prompt,
                    runtime_context=runtime_context,
                    expected_output_instruction=expected_output_instruction,
                )

        results = await asyncio.gather(*(run(task) for task in tasks))
        self._sort_delegations()
        self.set_output("delegations", [record.as_dict() for record in self._delegations])
        return sorted(results, key=lambda result: result["task_index"])

    async def _run_task(
        self,
        task: TeamTaskSpec,
        *,
        process: str,
        round_index: int,
        previous_context: str,
        user_prompt: str,
        runtime_context: str,
        expected_output_instruction: str,
    ) -> dict[str, Any]:
        context = _build_collaboration_context(
            user_prompt=user_prompt,
            runtime_context=runtime_context,
            task_context=task.context,
            previous_context=previous_context,
        )
        expected_output = task.expected_output
        if expected_output_instruction:
            expected_output += "\n\n" + expected_output_instruction
        started = time.perf_counter()
        sequence = 0
        entry_id = self._start_progress(
            worker=task.worker,
            task=task.task,
            process=process,
            round_index=round_index,
            task_index=task.index,
            context=context,
        )
        try:
            sequence = self._budget.claim()
            with delegation_scope(self._param.max_depth):
                result = await asyncio.wait_for(
                    self._run_worker(
                        task.worker,
                        task=task.task,
                        context=context,
                        expected_output=expected_output,
                    ),
                    timeout=self._param.worker_timeout,
                )
            content = _require_worker_content(task.worker.id, result)
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._delegations.append(
                DelegationRecord(
                    sequence=sequence,
                    worker_id=task.worker.id,
                    task=task.task,
                    context=context,
                    expected_output=expected_output,
                    status="ok",
                    result=content,
                    duration_ms=duration_ms,
                    metadata={
                        "process": process,
                        "round": round_index,
                        "task_index": task.index,
                        "role": "participant",
                    },
                )
            )
            self._finish_progress(entry_id, status="ok", result=content, elapsed_ms=duration_ms)
            return {
                "task_index": task.index,
                "worker_id": task.worker.id,
                "status": "ok",
                "content": content,
                "result": content,
                "error": "",
                "duration_ms": duration_ms,
            }
        except asyncio.CancelledError:
            # 中止运行时要给进度通道收尾，否则看板上的卡片永远停在"分发中"。
            self._finish_progress(
                entry_id,
                status="error",
                error="cancelled",
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
            raise
        except Exception as exc:
            if not isinstance(exc, DelegationError):
                _logger.exception("[AgentTeam] %s worker %s failed", process, task.worker.id)
            error = str(exc)
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._delegations.append(
                DelegationRecord(
                    sequence=sequence,
                    worker_id=task.worker.id,
                    task=task.task,
                    context=context,
                    expected_output=expected_output,
                    status="error",
                    error=error,
                    duration_ms=duration_ms,
                    metadata={
                        "process": process,
                        "round": round_index,
                        "task_index": task.index,
                        "role": "participant",
                    },
                )
            )
            self._finish_progress(entry_id, status="error", error=error, elapsed_ms=duration_ms)
            return {
                "task_index": task.index,
                "worker_id": task.worker.id,
                "status": "error",
                "content": "",
                "result": "",
                "error": error,
                "duration_ms": duration_ms,
            }

    async def _run_judge(
        self,
        *,
        process: str,
        round_index: int,
        task: str,
        context: str,
        expected_output: str,
    ) -> dict[str, Any]:
        worker = self._registry.resolve(self._param.judge)
        started = time.perf_counter()
        sequence = 0
        entry_id = self._start_progress(
            worker=worker,
            task=task,
            process=process,
            round_index=round_index,
            task_index=-1,
            role="judge",
            context=context,
        )
        try:
            sequence = self._budget.claim()
            with delegation_scope(self._param.max_depth):
                result = await asyncio.wait_for(
                    self._run_worker(worker, task=task, context=context, expected_output=expected_output),
                    timeout=self._param.worker_timeout,
                )
            content = _require_worker_content(worker.id, result)
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._delegations.append(
                DelegationRecord(
                    sequence=sequence,
                    worker_id=worker.id,
                    task=task,
                    context=context,
                    expected_output=expected_output,
                    status="ok",
                    result=content,
                    duration_ms=duration_ms,
                    metadata={"process": process, "round": round_index, "task_index": -1, "role": "judge"},
                )
            )
            self._finish_progress(entry_id, status="ok", result=content, elapsed_ms=duration_ms)
            return {"status": "ok", "content": content, "error": "", "worker_id": worker.id, "duration_ms": duration_ms}
        except asyncio.CancelledError:
            self._finish_progress(
                entry_id,
                status="error",
                error="cancelled",
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
            raise
        except Exception as exc:
            if not isinstance(exc, DelegationError):
                _logger.exception("[AgentTeam] %s judge failed", process)
            error = str(exc)
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._delegations.append(
                DelegationRecord(
                    sequence=sequence,
                    worker_id=worker.id,
                    task=task,
                    context=context,
                    expected_output=expected_output,
                    status="error",
                    error=error,
                    duration_ms=duration_ms,
                    metadata={"process": process, "round": round_index, "task_index": -1, "role": "judge"},
                )
            )
            self._finish_progress(entry_id, status="error", error=error, elapsed_ms=duration_ms)
            return {"status": "error", "content": "", "error": error, "worker_id": worker.id, "duration_ms": duration_ms}

    def _sort_delegations(self):
        self._delegations.sort(
            key=lambda record: (
                int(record.metadata.get("round") or 0),
                0 if record.metadata.get("role") == "participant" else 1,
                int(record.metadata.get("task_index") or -1),
                record.sequence,
            )
        )

    async def _run_worker(self, worker: WorkerSpec, *, task: str, context: str, expected_output: str) -> str:
        return await _execute_worker_agent(
            self._canvas,
            self._id,
            self._param.custom_header,
            worker,
            task=task,
            context=context,
            expected_output=expected_output,
            reasoning=f"AgentTeam selected worker {worker.id} for this task.",
        )

    def _build_manager_agent(self):
        from agent.component import component_class

        manager_params = _agent_params_from_spec(self._param.manager, component="AgentTeam")
        manager_params["sys_prompt"] = _manager_prompt(manager_params)
        team_header = _custom_header_dict(self._param.custom_header)
        manager_header = manager_params.get("custom_header")
        manager_params["custom_header"] = _custom_header_dict(manager_header) if isinstance(manager_header, Mapping) else team_header
        tools = manager_params.get("tools") or []
        if not isinstance(tools, list):
            raise ValueError("[AgentTeam] Manager tools must be a list")
        tools = [deepcopy(tool) for tool in tools if not (isinstance(tool, Mapping) and tool.get("component_name") == "DelegateTask")]
        tools.append(
            {
                "component_name": "DelegateTask",
                "params": {
                    "workers": deepcopy(self._param.workers),
                    "manager_id": self._id,
                    "max_delegations": self._param.max_delegations,
                    "max_depth": self._param.max_depth,
                    "worker_timeout": self._param.worker_timeout,
                    "custom_header": deepcopy(team_header),
                },
            }
        )
        manager_params["tools"] = tools
        param = component_class("AgentParam")()
        param.update(manager_params)
        param.check()
        self._manager_agent = component_class("Agent")(self._canvas, f"{self._id}-->manager", param)
        self._delegate_tool = next((tool for tool in self._manager_agent.tools.values() if isinstance(tool, DelegateTask)), None)
        if self._delegate_tool is not None:
            # 进度通道靠 DelegateTask 自己写，但它拿不到团队的 task_id；
            # 不在这里接线，hierarchical 的分派在看板上永远是空的。
            self._delegate_tool.team_task_id = self._progress_task_id
            self._delegate_tool.team_component_id = self._id
        if self._delegate_tool is None:
            raise RuntimeError("[AgentTeam] failed to attach DelegateTask to the manager")
        return self._manager_agent, self._delegate_tool

    def reset(self, only_output=False):
        manager = self._manager_agent
        if manager is not None:
            manager.reset(only_output=only_output)
        elif self._delegate_tool is not None:
            self._delegate_tool.reset(only_output=only_output)
        budget = getattr(self, "_budget", None)
        if budget is not None:
            budget.reset()
        self._delegations = []
        self._manager_agent = None
        self._delegate_tool = None
        super().reset(only_output=only_output)
