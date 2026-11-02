# AgentTeam Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native AgentTeam node to the existing RAGFlow Agent canvas with complete six-strategy configuration, validation, DSL persistence, and collaboration audit UI.

**Architecture:** Keep React Flow, the Zustand graph store, React Hook Form, the generic DSL bridge, and the existing execution timeline as the only state and execution paths. Add a focused AgentTeam domain module for defaults and validation, a native canvas node plus form sections, and a read-only normalizer/timeline for backend audit output.

**Tech Stack:** React 18, TypeScript 5, Vite, React Flow, Zustand, React Hook Form, Zod, i18next, Jest, Testing Library, Tailwind semantic tokens.

## Global Constraints

- Treat `AgentTeam` as one canvas node. Do not create a second team executor, graph store slice, or CRUD API.
- Support exactly `sequential`, `hierarchical`, `parallel`, `vote`, `debate`, and `consensus`.
- Hierarchical uses `manager`; every other strategy uses `tasks`.
- Only `vote`, `debate`, and `consensus` accept `judge`.
- Every Worker and Manager Agent parameter object must contain a non-empty `llm_id`.
- Preserve nested `manager.params`, `workers[].agent.params`, `tasks`, and `custom_header` through DSL import/export.
- Use the existing semantic color tokens and shared UI components. Do not edit `web/src/components/ui/`.
- Add copy only to `web/src/locales/en.ts` and `web/src/locales/zh.ts`.
- No production code is added before a focused test fails for the requested behavior.

---

### Task 1: AgentTeam Domain Types, Defaults, Validation, and Budget

**Files:**
- Modify: `web/src/interfaces/database/agent.ts`
- Modify: `web/src/constants/agent.tsx`
- Modify: `web/src/pages/agent/constant/index.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/interface.ts`
- Create: `web/src/pages/agent/form/agent-team-form/validation.ts`
- Create: `web/src/pages/agent/form/agent-team-form/validation.test.ts`

**Interfaces:**
- Consumes: existing `BaseNode<TForm>` and `Operator`.
- Produces: `AgentTeamProcess`, `IAgentTeamForm`, `IAgentTeamWorker`, `IAgentTeamTask`, `initialAgentTeamValues`.
- Produces: `sanitizeAgentTeamValues(values: IAgentTeamForm): IAgentTeamForm`.
- Produces: `calculateRequiredDelegations(values: IAgentTeamForm): number | null`.
- Produces: `validateAgentTeam(values: IAgentTeamForm): AgentTeamValidationIssue[]`.
- Produces: `AgentTeamValidationIssue = { path: string; message: string }`.

- [ ] **Step 1: Write failing validation tests**

```ts
describe('validateAgentTeam', () => {
  it('accepts a hierarchical team with a manager and workers', () => {
    expect(validateAgentTeam(makeTeam({ process: 'hierarchical' }))).toEqual(
      [],
    );
  });

  it('rejects duplicate worker ids and dangling references', () => {
    const issues = validateAgentTeam(
      makeTeam({
        process: 'sequential',
        workers: [makeWorker('writer'), makeWorker('writer')],
        tasks: [{ worker: 'missing', task: 'Draft', expected_output: 'Text' }],
      }),
    );
    expect(issues.map((item) => item.path)).toEqual(
      expect.arrayContaining(['workers.1.id', 'tasks.0.worker']),
    );
  });

  it('uses the backend worst-case budget', () => {
    expect(calculateRequiredDelegations(makeTeam({ process: 'vote' }))).toBe(3);
    expect(
      calculateRequiredDelegations(
        makeTeam({ process: 'debate', collaboration_rounds: 3 }),
      ),
    ).toBe(7);
  });
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `cd web; npx jest src/pages/agent/form/agent-team-form/validation.test.ts --runInBand --coverage=false`

Expected: FAIL because `validation.ts` and the AgentTeam types do not exist.

- [ ] **Step 3: Add the types and defaults**

Add `Operator.AgentTeam = 'AgentTeam'`, the six-process union, Worker/Task/Form interfaces, `IAgentTeamNode`, and `initialAgentTeamValues`. The initial Manager and Worker Agent params must use:

```ts
{
  llm_id: '',
  sys_prompt: '',
  prompts: [{ role: 'user', content: '{sys.query}' }],
  max_rounds: 5,
  tools: [],
}
```

Use `max_concurrency: 4`, `collaboration_rounds: 3`, `max_delegations: 8`, `max_depth: 3`, and `worker_timeout: 300`.

- [ ] **Step 4: Implement sanitization, budget, and validation**

`hierarchical` sanitizes to empty `tasks` and `judge`; other processes sanitize to an empty `manager`. Strategies without a Judge sanitize `judge` to `''`. Budget logic is exactly:

```ts
sequential / parallel: tasks.length
vote: tasks.length + (judge ? 1 : 0)
debate / consensus: tasks.length * rounds + (judge ? 1 : 0)
hierarchical: null
```

Validation covers every rule in section 8 of the design spec and returns field paths such as `workers.0.agent.params.llm_id`, `tasks.1.worker`, and `max_delegations`.

- [ ] **Step 5: Run the focused test to verify GREEN**

Run: `cd web; npx jest src/pages/agent/form/agent-team-form/validation.test.ts --runInBand --coverage=false`

Expected: PASS.

### Task 2: Canvas Operator, Node Summary, and Initial Parameters

**Files:**
- Modify: `web/src/pages/agent/constant/index.tsx`
- Modify: `web/src/pages/agent/hooks/use-add-node.ts`
- Modify: `web/src/pages/agent/canvas/index.tsx`
- Modify: `web/src/pages/agent/canvas/node/dropdown/accordion-operators.tsx`
- Modify: `web/src/components/operator-icon.tsx`
- Modify: `web/src/pages/agent/context.ts`
- Modify: `web/src/pages/agent/hooks/use-node-loading.ts`
- Create: `web/src/pages/agent/canvas/node/agent-team-node.tsx`

**Interfaces:**
- Consumes: `initialAgentTeamValues`, `IAgentTeamForm`, `AgentInstanceContext`.
- Produces: `NodeMap[Operator.AgentTeam] === 'agentTeamNode'`.
- Produces: `AgentTeamNode` exported for React Flow registration.

- [ ] **Step 1: Write a failing registration test**

```ts
it('registers AgentTeam as a native canvas node', () => {
  expect(Operator.AgentTeam).toBe('AgentTeam');
  expect(NodeMap[Operator.AgentTeam]).toBe('agentTeamNode');
});
```

Run: `cd web; npx jest src/pages/agent/constant/index.test.ts --runInBand --coverage=false`

Expected: FAIL because the enum and map entry are missing.

- [ ] **Step 2: Register the operator and initial form**

Add it to the foundation group beside Agent, to `RestrictedUpstreamMap`, `AgentOperatorList`, `NodeMap`, `useInitializeOperatorParams`, and the React Flow `nodeTypes`.

- [ ] **Step 3: Add runtime status context**

Expose `lastFinishedNode` from `useNodeLoading` and provide it through `AgentInstanceContext`. AgentTeam uses the existing `currentSendLoading` and `startButNotFinishedNodeIds`; no new store is added.

- [ ] **Step 4: Build the native node**

Reuse `ToolBar`, `NodeWrapper`, `NodeHeader`, `LeftEndHandle`, and `CommonHandle`. Show strategy, worker count, task or Manager summary, Judge badge, and `notRun/running/success/partial/failed` status. Map `Operator.AgentTeam` to lucide `UsersRound`.

- [ ] **Step 5: Run the registration test and type-check**

Run: `cd web; npx jest src/pages/agent/constant/index.test.ts --runInBand --coverage=false; npm run type-check`

Expected: PASS for the test and no TypeScript errors.

### Task 3: Complete AgentTeam Configuration Form

**Files:**
- Modify: `web/src/pages/agent/form-sheet/form-config-map.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/index.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/process-selector.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/manager-field.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/agent-config-fields.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/worker-list.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/worker-card.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/task-list.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/task-card.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/run-guardrails.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/team-output.tsx`
- Create: `web/src/pages/agent/form/agent-team-form/use-team-form.ts`
- Create: `web/src/pages/agent/form/agent-team-form/process-selector.test.tsx`

**Interfaces:**
- Consumes: `IAgentTeamForm`, `initialAgentTeamValues`, `validateAgentTeam`, `calculateRequiredDelegations`.
- Produces: `AgentTeamForm` component matching `INextOperatorForm`.
- Produces: sanitized graph synchronization through the existing `updateNodeForm`.

- [ ] **Step 1: Write a failing process visibility test**

```tsx
it('shows Manager only for hierarchical and Tasks for other strategies', async () => {
  render(<ProcessSelectorHarness />);
  expect(screen.getByText('Manager')).toBeInTheDocument();
  expect(screen.queryByText('Tasks')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Parallel' }));
  expect(screen.queryByText('Manager')).not.toBeInTheDocument();
  expect(screen.getByText('Tasks')).toBeInTheDocument();
});
```

Run: `cd web; npx jest src/pages/agent/form/agent-team-form/process-selector.test.tsx --runInBand --coverage=false`

Expected: FAIL because the selector and form sections do not exist.

- [ ] **Step 2: Build the form shell and synchronization**

Use `useForm<IAgentTeamForm>` with `mode: 'onChange'` and a Zod resolver that converts `AgentTeamValidationIssue[]` to RHF issues. Synchronize with `useWatch` through a small hook that writes `sanitizeAgentTeamValues(form.getValues())` to the existing graph node. Merge the default LLM into the Manager only when its `llm_id` is empty.

- [ ] **Step 3: Add the six-process selector**

Render a responsive 3-by-2 segmented control. Define click handlers outside JSX. Keep hidden values in local form state while the graph sync receives sanitized values.

- [ ] **Step 4: Add Manager and Worker Agent configuration**

Share `AgentConfigFields` for `manager.params.*` and `workers.N.agent.params.*`: model selector, system prompt, user prompt, max rounds, and JSON tool list. Use the existing `NextLLMSelect`, `Textarea`, and `NumberInput`; do not duplicate model-fetching state.

- [ ] **Step 5: Add Worker management**

Workers have collapsible cards with ID, display name, role, capability tags, description, and Agent params. Adding creates a unique default ID. Deleting a referenced Worker uses `ConfirmDeleteDialog`, then removes the Worker and clears Task/Judge references. Duplicate IDs and invalid references render inline messages.

- [ ] **Step 6: Add Task management and Judge selection**

Tasks support add, delete, up/down reorder, Worker selection, task text, context, and expected output. Vote and Consensus show the required JSON vote shape. Judge is shown only for Vote/Debate/Consensus and uses the current Worker registry with a clear option.

- [ ] **Step 7: Add guardrails, custom headers, and output contract**

Show concurrency only for collaborative processes, rounds only for Debate/Consensus, and always show delegation/depth/timeout bounds. Display the real-time required delegation count and inline budget error. Accept a JSON object for `custom_header`. Render the eight stable outputs read-only.

- [ ] **Step 8: Run focused UI test and type-check**

Run: `cd web; npx jest src/pages/agent/form/agent-team-form/process-selector.test.tsx --runInBand --coverage=false; npm run type-check`

Expected: PASS for the visibility behavior and no type errors.

### Task 4: Run Output Normalization and Team Timeline

**Files:**
- Create: `web/src/pages/agent/log-sheet/agent-team-output.ts`
- Create: `web/src/pages/agent/log-sheet/agent-team-output.test.ts`
- Create: `web/src/pages/agent/log-sheet/agent-team-timeline.tsx`
- Create: `web/src/pages/agent/log-sheet/agent-team-timeline.test.tsx`
- Modify: `web/src/pages/agent/log-sheet/workflow-timeline.tsx`

**Interfaces:**
- Consumes: `INodeData['outputs']`.
- Produces: `normalizeAgentTeamOutput(raw: unknown): NormalizedAgentTeamOutput`.
- Produces: `AgentTeamTimeline({ outputs, elapsedTime, error })`.

- [ ] **Step 1: Write failing normalizer tests**

```ts
it('uses the last run and parses structured JSON', () => {
  const result = normalizeAgentTeamOutput([
    { winner: 'old' },
    {
      winner: 'new',
      structured: '{"resolution":"judge","status":"partial"}',
      _ERROR: 'worker failed',
      delegations: [
        { worker_id: 'b', sequence: 2, round: 1, task_index: 1 },
        { worker_id: 'a', sequence: 1, round: 1, task_index: 0 },
      ],
    },
  ]);
  expect(result.winner).toBe('new');
  expect(result.structured.resolution).toBe('judge');
  expect(result.status).toBe('partial');
  expect(result.delegations.map((item) => item.worker_id)).toEqual(['a', 'b']);
});
```

Run: `cd web; npx jest src/pages/agent/log-sheet/agent-team-output.test.ts --runInBand --coverage=false`

Expected: FAIL because the normalizer does not exist.

- [ ] **Step 2: Implement normalization and grouping**

Handle object payloads, arrays of runs, JSON strings, malformed structured JSON, missing fields, delegation sorting, vote grouping including invalid votes, and `_ERROR`. Preserve raw output for fallback display.

- [ ] **Step 3: Build the team timeline**

Render summary, delegation timeline, vote totals, round discussions, conclusion (`winner`, `consensus`, `resolution`, Judge result), and failures. Use semantic badges/cards with radius no greater than 8px. Long task/result text wraps or exposes full text in a scrollable block.

- [ ] **Step 4: Integrate without changing other nodes**

In `WorkFlowTimeline`, when `x.data.component_type === 'AgentTeam'`, render `AgentTeamTimeline` above the existing Input/Output JSON accordions. All other component types keep the current behavior.

- [ ] **Step 5: Run focused output tests**

Run: `cd web; npx jest src/pages/agent/log-sheet/agent-team-output.test.ts src/pages/agent/log-sheet/agent-team-timeline.test.tsx --runInBand --coverage=false`

Expected: PASS for normalization and all rendered collaboration states.

### Task 5: Localization, DSL Regression, and Full Verification

**Files:**
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/zh.ts`
- Modify: `web/src/pages/agent/utils/tests/dsl-bridge.test.ts`
- Update as needed: `web/src/pages/agent/form/agent-team-form/*`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: complete English/Chinese UI and a round-trip DSL fixture containing AgentTeam.

- [ ] **Step 1: Add the AgentTeam DSL round-trip test**

```ts
it('preserves AgentTeam nested configuration through export and import', () => {
  const fixture = makeAgentTeamDslFixture();
  const exported = roundTrip(bridge, fixture);
  const component = exported.components['AgentTeam:Research'];
  expect(component.obj.component_name).toBe('AgentTeam');
  expect(component.obj.params.manager.params.llm_id).toBe('manager-model');
  expect(component.obj.params.workers[0].agent.params.llm_id).toBe('worker-model');
  expect(component.obj.params.tasks).toEqual(fixture.components['AgentTeam:Research'].obj.params.tasks);
});
```

Run: `cd web; npx jest src/pages/agent/utils/tests/dsl-bridge.test.ts --runInBand --coverage=false`

Expected: PASS if the generic bridge already preserves nested fields; if it does not, make the smallest generic fix and rerun.

- [ ] **Step 2: Add all translations**

Add `flow.agentTeam` labels, strategy descriptions, Worker/Task/Judge/guardrail copy, validation messages, runtime statuses, and audit timeline labels to both locales. Reuse existing output/tool labels where already present.

- [ ] **Step 3: Run the complete frontend verification**

Run:

```bash
cd web
npm run type-check
npm run lint
npm run test -- --runInBand
npm run build
```

Expected: every command exits 0. Record any pre-existing unrelated failures separately rather than weakening the new tests.

- [ ] **Step 4: Review the resulting diff**

Run: `git diff --stat; git diff -- web`

Expected: only AgentTeam frontend integration, targeted DSL regression coverage, locale entries, design/plan documents, and no edits to `web/src/components/ui/`.
