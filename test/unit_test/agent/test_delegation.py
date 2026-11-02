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

import pytest

from agent.delegation import (
    DelegationBudget,
    DelegationError,
    WorkerRegistry,
    WorkerSpec,
    current_delegation_depth,
    delegation_scope,
)


def _worker(worker_id: str, *, role: str = "", capabilities: tuple[str, ...] = ()) -> WorkerSpec:
    return WorkerSpec(
        id=worker_id,
        name=worker_id.title(),
        role=role,
        capabilities=capabilities,
        description=f"{worker_id} worker",
        agent_config={"llm_id": "test"},
    )


def test_registry_resolves_worker_by_capability():
    registry = WorkerRegistry([_worker("researcher", role="research", capabilities=("web_search",))])

    resolved = registry.resolve("web_search")

    assert resolved.id == "researcher"


def test_registry_rejects_ambiguous_capability():
    registry = WorkerRegistry(
        [
            _worker("researcher_a", capabilities=("web_search",)),
            _worker("researcher_b", capabilities=("web_search",)),
        ]
    )

    with pytest.raises(DelegationError, match="ambiguous"):
        registry.resolve("web_search")


def test_registry_rejects_worker_that_identifies_the_manager():
    with pytest.raises(DelegationError, match="manager"):
        WorkerRegistry(
            [_worker("manager")],
            manager_id="manager",
        )


def test_registry_rejects_duplicate_worker_ids():
    with pytest.raises(DelegationError, match="duplicate"):
        WorkerRegistry([_worker("writer"), _worker("writer")])


def test_delegation_budget_rejects_calls_over_limit():
    budget = DelegationBudget(max_delegations=1)

    assert budget.claim() == 1
    with pytest.raises(DelegationError, match="max_delegations"):
        budget.claim()


def test_delegation_scope_enforces_nested_depth():
    with delegation_scope(max_depth=1):
        assert current_delegation_depth() == 1
        with pytest.raises(DelegationError, match="max_depth"):
            with delegation_scope(max_depth=1):
                pass

    assert current_delegation_depth() == 0


def test_worker_spec_unwraps_agent_component_params():
    worker = WorkerSpec.from_mapping(
        {
            "id": "writer",
            "agent": {
                "component_name": "Agent",
                "params": {"llm_id": "writer-model"},
            },
        }
    )

    assert worker.agent_config == {"llm_id": "writer-model"}
