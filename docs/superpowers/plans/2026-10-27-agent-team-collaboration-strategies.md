# AgentTeam Collaboration Strategies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Manager prompt injection, executable Parallel/Vote/Debate/Consensus strategies, and verified point-to-point `DelegateTask` calls inside the existing Agent ReAct loop.

**Architecture:** Keep `agent/component/agent_with_tools.py` as the ReAct executor and `DelegateTaskTool` as the point-to-point tool. Add pure collaboration parsing and voting logic in `agent/collaboration.py`, then orchestrate concurrent Worker calls and Judge calls from `AgentTeam` using the existing budget, depth, timeout, and audit primitives.

**Tech Stack:** Python 3.13, asyncio, dataclasses, existing RAGFlow Canvas components, pytest, ruff.

## Global Constraints

- Preserve `process="hierarchical"` as the default.
- Do not create a second Agent runtime.
- Do not expose Worker model or tool configuration through the Manager tool schema.
- Every Worker and Judge call consumes `max_delegations`.
- Every Worker and Judge call is bounded by `max_depth` and `worker_timeout`.
- Parallel batches obey `max_concurrency`.
- Vote and Consensus only count valid JSON votes.
- No production code is added before a test fails for the requested behavior.

---

### Task 1: Collaboration Domain Logic

**Files:**
- Create: `agent/collaboration.py`
- Modify: `agent/delegation.py`
- Test: `test/unit_test/agent/test_collaboration.py`

**Interfaces:**
- Consumes: `WorkerSpec` and `TeamTaskSpec` from `agent.delegation`.
- Produces: `parse_vote(task_index: int, worker_id: str, text: str) -> dict[str, Any]`
- Produces: `tally_votes(votes: Sequence[Mapping[str, Any]]) -> dict[str, Any]`
- Produces: `parse_judge(text: str, candidates: Sequence[str]) -> dict[str, Any]`
- Produces: `build_previous_round_context(responses: Sequence[Mapping[str, Any]], current_task_index: int) -> str`
- Produces: `consensus_choice(votes: Sequence[Mapping[str, Any]], expected_count: int) -> str`

- [ ] Write tests for fenced and inline JSON vote parsing, invalid confidence, count ties, confidence tie-break, Judge candidate validation, previous-round self exclusion, and unanimous consensus.
- [ ] Run `python -m pytest test/unit_test/agent/test_collaboration.py -q -p no:cacheprovider`; expect import failures because `agent.collaboration` does not exist.
- [ ] Add process constants and `TeamTaskSpec` in `agent/delegation.py`.
- [ ] Implement the pure functions in `agent/collaboration.py` without Canvas or I/O dependencies.
- [ ] Re-run the tests; expect PASS.

### Task 2: Parameter Model and Manager Prompt

**Files:**
- Modify: `agent/component/agent_team.py`
- Test: `test/unit_test/agent/component/test_agent_team.py`

**Interfaces:**
- Consumes: `AGENT_TEAM_PROCESSES`, `COLLABORATION_PROCESSES`, `TeamTaskSpec`.
- Produces: `MANAGER_DELEGATION_PROMPT: str`
- Produces: `AgentTeamParam.max_concurrency`, `collaboration_rounds`, `judge`.

- [ ] Write tests that accept all six processes, reject invalid concurrency and rounds, validate the worst-case budget, resolve the optional Judge, and prepend/append the Manager policy without discarding caller instructions.
- [ ] Run the component tests; expect failures for missing parameters and missing prompt injection.
- [ ] Add parameter defaults and validation.
- [ ] Add a helper that composes `MANAGER_DELEGATION_PROMPT` with the configured Manager `sys_prompt`.
- [ ] Apply the composed prompt in `_build_manager_agent()`.
- [ ] Re-run the focused tests; expect PASS.

### Task 3: Shared Concurrent Delegation Executor

**Files:**
- Modify: `agent/component/agent_team.py`
- Test: `test/unit_test/agent/component/test_agent_team.py`

**Interfaces:**
- Consumes: `TeamTaskSpec`, `DelegationBudget`, `delegation_scope`.
- Produces: `AgentTeam._run_task_batch(tasks, *, process, round_index, previous_context) -> list[dict[str, Any]]`
- Produces: `AgentTeam._run_judge(*, process, round_index, task, context, expected_output) -> dict[str, Any]`

- [ ] Write a test with an artificial delay that proves active concurrency never exceeds `max_concurrency`.
- [ ] Write a test where one Worker raises and another succeeds, proving the success survives and both records are audited.
- [ ] Run the tests; expect failure because no batch executor exists.
- [ ] Implement one semaphore-bounded `asyncio.gather()` batch executor.
- [ ] Claim budget before each invocation, apply depth and timeout, require non-empty content, and append ordered audit records.
- [ ] Re-run the tests; expect PASS.

### Task 4: Parallel and Vote

**Files:**
- Modify: `agent/component/agent_team.py`
- Test: `test/unit_test/agent/component/test_agent_team.py`

**Interfaces:**
- Consumes: `_run_task_batch`, `parse_vote`, `tally_votes`, `parse_judge`.
- Produces: `AgentTeam._invoke_parallel_async(**kwargs)`
- Produces: `AgentTeam._invoke_vote_async(**kwargs)`

- [ ] Write tests for Parallel partial failure and stable JSON output.
- [ ] Write tests for Vote count victory, confidence tie-break, Judge tie-break, and no-winner tie without Judge.
- [ ] Run the tests; expect failures for missing dispatch.
- [ ] Implement `parallel` output with `results`, `rounds`, and `status`.
- [ ] Implement `vote` parsing, tallying, optional Judge, `votes`, `winner`, and `tie_break`.
- [ ] Re-run the tests; expect PASS.

### Task 5: Debate and Consensus

**Files:**
- Modify: `agent/component/agent_team.py`
- Test: `test/unit_test/agent/component/test_agent_team.py`

**Interfaces:**
- Consumes: `_run_task_batch`, `_run_judge`, `build_previous_round_context`, `parse_vote`, `consensus_choice`, `tally_votes`.
- Produces: `AgentTeam._invoke_debate_async(**kwargs)`
- Produces: `AgentTeam._invoke_consensus_async(**kwargs)`

- [ ] Write tests for Debate round context excluding self and Judge summary fallback.
- [ ] Write tests for Consensus early stop, Judge resolution, Vote fallback, and no-winner exhaustion.
- [ ] Run the tests; expect failures for missing dispatch.
- [ ] Implement Debate rounds and optional summarizer Judge.
- [ ] Implement Consensus rounds, early stop, Judge candidates, and final-round Vote fallback.
- [ ] Re-run the tests; expect PASS.

### Task 6: ReAct Point-to-Point Verification

**Files:**
- Modify: `agent/component/agent_team.py` only if the path is missing.
- Test: `test/unit_test/agent/component/test_agent_team.py`

**Interfaces:**
- Consumes: `Agent._load_tool_obj()` from `agent/component/agent_with_tools.py`, `LLMToolPluginCallSession`, `DelegateTaskTool`.
- Produces: an asserted ReAct call path: configured Agent tool -> LLM tool session -> `DelegateTaskTool._invoke_async()` -> Worker Observation.

- [ ] Write a test proving a tool session created from an Agent-style tool map dispatches `DelegateTaskTool._invoke_async()`.
- [ ] Run the existing path test first; if it passes, record that point-to-point ReAct support already exists and do not add duplicate production code.
- [ ] Keep the Manager default prompt so the hierarchical Manager reliably selects the tool.
- [ ] Run focused tests; expect PASS.

### Task 7: Documentation and Verification

**Files:**
- Modify: `docs/develop/agent_team_delegation_zh.md`
- Modify: `docs/superpowers/specs/2026-10-27-agent-team-collaboration-strategies-design.md` only if implementation exposes a contradiction.

- [ ] Replace the current-limitations section with six-process usage, costs, outputs, Judge behavior, and failure rules.
- [ ] Add Parallel, Vote, Debate, and Consensus DSL examples.
- [ ] Document the automatic Manager prompt and its override behavior.
- [ ] Document the existing ReAct point-to-point chain with exact component paths.
- [ ] Run `python -m pytest test/unit_test/agent/test_collaboration.py test/unit_test/agent/test_delegation.py test/unit_test/agent/component/test_agent_team.py -q -p no:cacheprovider`.
- [ ] Run `python -m ruff check agent/delegation.py agent/collaboration.py agent/component/agent_team.py`.
- [ ] Run `python -m ruff format --check agent/delegation.py agent/collaboration.py agent/component/agent_team.py`.
- [ ] Run `python -m compileall -q agent/delegation.py agent/collaboration.py agent/component/agent_team.py`.

## Verification Notes

Git writes are currently blocked by `.git/index.lock` permissions in this workspace, so commit steps cannot be completed until the repository metadata is writable. Production verification must still complete before handoff.
