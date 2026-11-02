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

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Mapping

"""Shared controls for AgentTeam processes and point-to-point delegation.

The module owns worker registration, policy checks, budgets, nested-depth tracking,
and audit records. Strategy execution stays in the AgentTeam component.
"""
"""
这个文件是“AgentTeam 任务委派模块”，它的职责是：
1. 维护一个“Worker 注册表”，让系统知道有哪些 Worker 可用，以及它们的能力和配置
2. 提供一个“委派预算”，限制在一个 AgentTeam 执行过程中，最多能委派多少次任务给 Worker
3. 提供一个“委派深度追踪”，限制在一个 AgentTeam 执行过程中，最多能嵌套多少层委派调用，避免无限递归
4. 提供一个“委派记录”，记录每次委派的任务、Worker、上下文、结果
5. 提供一个统一的“委派异常”，当委派请求违反策略时"""


SEQUENTIAL_PROCESS = "sequential" #按顺序执行的 AgentTeam 任务
HIERARCHICAL_PROCESS = "hierarchical" #按层级执行的 AgentTeam 任务
PARALLEL_PROCESS = "parallel" #并行执行的 AgentTeam 任务
VOTE_PROCESS = "vote"   #投票式执行的 AgentTeam 任务
DEBATE_PROCESS = "debate"   #辩论式执行的 AgentTeam 任务
CONSENSUS_PROCESS = "consensus" #共识式执行的 AgentTeam 任务
COLLABORATION_PROCESSES = frozenset((PARALLEL_PROCESS, VOTE_PROCESS, DEBATE_PROCESS, CONSENSUS_PROCESS))
AGENT_TEAM_PROCESSES = frozenset((SEQUENTIAL_PROCESS, HIERARCHICAL_PROCESS)) | COLLABORATION_PROCESSES


class DelegationError(ValueError):
    """A delegation request violated a manager or worker policy."""


@dataclass(frozen=True)
class WorkerSpec:
    id: str
    name: str
    role: str
    capabilities: tuple[str, ...]
    description: str
    agent_config: Mapping[str, Any]

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "WorkerSpec":
        worker_id = str(value.get("id") or value.get("name") or "").strip()
        if not worker_id:
            raise DelegationError("worker requires a non-empty id")
        capabilities = value.get("capabilities") or ()
        if isinstance(capabilities, str):
            capabilities = [capabilities]
        if not isinstance(capabilities, (list, tuple)):
            raise DelegationError(f"worker {worker_id!r} capabilities must be a list or string")
        agent_config = value.get("agent") or value.get("params") or {}
        if isinstance(agent_config, Mapping) and isinstance(agent_config.get("params"), Mapping):
            agent_config = agent_config["params"]
        return cls(
            id=worker_id,
            name=str(value.get("name") or worker_id).strip(),
            role=str(value.get("role") or "").strip(),
            capabilities=tuple(str(item).strip() for item in capabilities if str(item).strip()),
            description=str(value.get("description") or "").strip(),
            agent_config=agent_config,
        )

    def roster_entry(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "capabilities": list(self.capabilities),
            "description": self.description,
        }


@dataclass(frozen=True)
class TeamTaskSpec:
    """A concrete worker invocation shared by every AgentTeam process."""

    index: int
    worker: WorkerSpec
    task: str
    context: str
    expected_output: str

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any], registry: WorkerRegistry, index: int) -> "TeamTaskSpec":
        if not isinstance(value, Mapping):
            raise DelegationError(f"task {index + 1} must be an object")
        selector = str(value.get("worker") or "").strip()
        task = str(value.get("task") or "").strip()
        expected_output = str(value.get("expected_output") or "").strip()
        if not task:
            raise DelegationError(f"task {index + 1} requires a non-empty task")
        if not expected_output:
            raise DelegationError(f"task {index + 1} requires a non-empty expected_output")
        return cls(
            index=index,
            worker=registry.resolve(selector),
            task=task,
            context=str(value.get("context") or "").strip(),
            expected_output=expected_output,
        )


class WorkerRegistry:
    """Resolve a manager-selected worker id, role, or capability."""

    def __init__(self, workers: Iterable[WorkerSpec | Mapping[str, Any]], manager_id: str = ""):
        self._workers: dict[str, WorkerSpec] = {}
        self._manager_id = manager_id.strip()
        for raw_worker in workers:
            worker = raw_worker if isinstance(raw_worker, WorkerSpec) else WorkerSpec.from_mapping(raw_worker)
            key = self._normalize(worker.id)
            if key == self._normalize(self._manager_id):
                raise DelegationError(f"worker {worker.id!r} cannot be the manager itself")
            if key in self._workers:
                raise DelegationError(f"duplicate worker id {worker.id!r}")
            if not isinstance(worker.agent_config, Mapping) or not worker.agent_config:
                raise DelegationError(f"worker {worker.id!r} requires agent params")
            self._workers[key] = worker

    @staticmethod
    def _normalize(value: str) -> str:
        return value.strip().lower()

    @property
    def workers(self) -> tuple[WorkerSpec, ...]:
        return tuple(self._workers.values())

    def resolve(self, selector: str) -> WorkerSpec:
        needle = self._normalize(selector)
        if not needle:
            raise DelegationError("delegate_task requires a worker")

        for worker in self._workers.values():
            if self._normalize(worker.id) == needle:
                return worker

        for attribute in ("name", "role"):
            matches = [worker for worker in self._workers.values() if self._normalize(getattr(worker, attribute)) == needle]
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                raise DelegationError(f"delegate_task worker selector {selector!r} is ambiguous by {attribute}")

        matches = [worker for worker in self._workers.values() if needle in {self._normalize(capability) for capability in worker.capabilities}]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise DelegationError(f"delegate_task worker selector {selector!r} is ambiguous by capability")
        raise DelegationError(f"delegate_task worker {selector!r} is not registered")

    def describe(self) -> str:
        lines = []
        for worker in self._workers.values():
            details = [f"id={worker.id}"]
            if worker.role:
                details.append(f"role={worker.role}")
            if worker.capabilities:
                details.append("capabilities=" + ",".join(worker.capabilities))
            if worker.description:
                details.append(f"description={worker.description}")
            lines.append("; ".join(details))
        return "\n".join(lines)


@dataclass
class DelegationBudget:
    max_delegations: int
    used: int = 0

    def __post_init__(self) -> None:
        if self.max_delegations < 1:
            raise DelegationError("max_delegations must be at least 1")

    def claim(self) -> int:
        if self.used >= self.max_delegations:
            raise DelegationError(f"max_delegations ({self.max_delegations}) exceeded")
        self.used += 1
        return self.used

    def reset(self) -> None:
        self.used = 0


@dataclass
class DelegationRecord:
    sequence: int
    worker_id: str
    task: str
    context: str
    expected_output: str
    status: str
    result: str = ""
    error: str = ""
    duration_ms: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "sequence": self.sequence,
            "worker_id": self.worker_id,
            "task": self.task,
            "context": self.context,
            "expected_output": self.expected_output,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "duration_ms": self.duration_ms,
            "metadata": dict(self.metadata),
        }


_delegation_depth: ContextVar[int] = ContextVar("ragflow_delegation_depth", default=0)


def current_delegation_depth() -> int:
    return _delegation_depth.get()


@contextmanager
def delegation_scope(max_depth: int) -> Iterator[int]:
    depth = current_delegation_depth()
    if max_depth < 1:
        raise DelegationError("max_depth must be at least 1")
    if depth >= max_depth:
        raise DelegationError(f"max_depth ({max_depth}) exceeded")
    token = _delegation_depth.set(depth + 1)
    try:
        yield depth + 1
    finally:
        _delegation_depth.reset(token)
