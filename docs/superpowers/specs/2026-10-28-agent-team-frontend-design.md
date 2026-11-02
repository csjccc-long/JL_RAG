# AgentTeam 多智能体协作前端设计

## 1. 目标

在现有 React/Vite Agent 画布中增加一等公民 `AgentTeam` 节点，让用户不写 DSL 就能创建、配置、运行和审计多智能体协作流程。

本设计覆盖后端已经支持的六种策略：

- `sequential`
- `hierarchical`
- `parallel`
- `vote`
- `debate`
- `consensus`

前端必须沿用当前画布的 React Flow 图、Zustand 表单状态、DSL bridge、运行事件和日志时间线，不增加独立执行器或第二套团队状态。

## 2. 非目标

- 不修改 Python `AgentTeam` 的执行语义。
- 不新增多智能体列表页、团队持久化模型或独立 CRUD API。
- 不把 Worker 当作画布上的独立 Agent 节点；本功能配置的是单个 `AgentTeam` 节点的内部团队。
- 不实现浏览器端运行、投票计票或共识判断；这些结果由后端输出，前端只做校验提示和可视化。
- 不为 `DelegateTask` 增加独立画布节点；它仍是普通 Agent 内部可用工具。

## 3. 当前差距

当前仓库已经具备：

- React/Vite Agent 列表、画布、节点表单、DSL 保存和调试运行。
- 普通 `Agent` 节点及模型、提示词、工具、结构化输出配置。
- 运行事件时间线、JSON 输入输出查看和节点加载状态。
- Python `AgentTeam`、`DelegateTask`、六种策略、预算、深度、超时和审计输出。

当前缺少：

- `Operator.AgentTeam` 和画布节点注册。
- `AgentTeamParam` 对应的完整表单。
- Worker、Task、Manager、Judge 和运行约束的可编辑界面。
- `AgentTeam` 节点摘要和协作结果专用展示。
- 与后端参数校验一致的前端错误提示。
- `AgentTeam` 中英文文案和表单测试。

## 4. 交互结构

```text
Agent 画布
  └─ AgentTeam 节点
      ├─ 节点头部：团队图标、名称、策略摘要
      ├─ 配置抽屉
      │   ├─ 执行策略
      │   ├─ Manager（仅 hierarchical）
      │   ├─ Workers
      │   ├─ Tasks（除 hierarchical）
      │   ├─ Judge（vote/debate/consensus）
      │   ├─ 运行约束
      │   └─ 输出契约
      └─ 运行日志
          ├─ 委派时间线
          ├─ 投票与置信度
          ├─ 轮次观点
          ├─ winner / consensus / resolution
          └─ 错误和预算耗尽信息
```

配置抽屉保持现有 Sheet 宽度和视觉层级。复杂列表使用可折叠区域，避免一次性铺开所有 Worker 与 Task。

## 5. 节点注册与摘要

### 5.1 Operator 与节点类型

新增：

```text
Operator.AgentTeam = "AgentTeam"
NodeMap[Operator.AgentTeam] = "agentTeamNode"
```

`agentTeamNode` 复用现有 `ToolBar`、`NodeWrapper`、`NodeHeader`、连接手柄和删除/复制行为。节点保留一个标准右侧输出口和一个左侧输入口。

节点使用 `lucide-react` 的团队类图标，不新增手绘 SVG。

### 5.2 节点摘要

节点内展示：

- 当前策略名称。
- Worker 数量。
- 任务数量或 Manager 状态。
- Judge 是否存在。
- 最近一次运行状态：未运行、运行中、成功、部分成功、失败。

节点只读取当前 DSL 配置和 `AgentInstanceContext` 的加载状态，不保存运行副本。

### 5.3 菜单位置

在画布“基础”分组中，把 `AgentTeam` 放在 `Agent` 旁边。描述文案说明它适合固定团队和结构化协作，不把静态画布多节点编排描述成替代方案。

## 6. 表单数据模型

前端类型直接映射后端 `AgentTeamParam`：

```ts
type AgentTeamProcess =
  | 'sequential'
  | 'hierarchical'
  | 'parallel'
  | 'vote'
  | 'debate'
  | 'consensus';

interface AgentTeamWorker {
  id: string;
  name?: string;
  role?: string;
  capabilities?: string[];
  description?: string;
  agent: {
    params: Record<string, unknown>;
  };
}

interface AgentTeamTask {
  worker: string;
  task: string;
  context?: string;
  expected_output: string;
}

interface AgentTeamFormValues {
  process: AgentTeamProcess;
  manager: {
    params: Record<string, unknown>;
  };
  workers: AgentTeamWorker[];
  tasks: AgentTeamTask[];
  max_concurrency: number;
  collaboration_rounds: number;
  judge: string;
  max_delegations: number;
  max_depth: number;
  worker_timeout: number;
  custom_header: Record<string, string>;
  outputs: Record<string, { type: string; value?: unknown }>;
}
```

Worker 内部 Agent 至少配置 `llm_id`。表单复用现有 `LargeModelFormField` 所需的数据结构，但不把 Manager 和 Worker 的模型候选状态提升到页面级。

初始值：

```ts
{
  process: 'hierarchical',
  manager: {
    params: {
      llm_id: defaultLlmId,
      sys_prompt: '',
      prompts: [],
      max_rounds: 8,
      tools: [],
    },
  },
  workers: [],
  tasks: [],
  max_concurrency: 4,
  collaboration_rounds: 3,
  judge: '',
  max_delegations: 8,
  max_depth: 3,
  worker_timeout: 300,
  custom_header: {},
  outputs: {
    content: { type: 'string', value: '' },
    structured: { type: 'object', value: {} },
    delegations: { type: 'Array<Object>', value: [] },
    votes: { type: 'Array<Object>', value: [] },
    rounds: { type: 'Array<Object>', value: [] },
    consensus: { type: 'boolean', value: false },
    winner: { type: 'string', value: null },
  },
}
```

## 7. 表单组件

新增表单目录：

```text
web/src/pages/agent/form/agent-team-form/
  index.tsx
  process-selector.tsx
  manager-field.tsx
  worker-list.tsx
  worker-card.tsx
  task-list.tsx
  task-card.tsx
  run-guardrails.tsx
  team-output.tsx
  use-team-form.ts
  validation.ts
  interface.ts
```

### 7.1 执行策略

使用分段选择控件展示六种策略，每项带短标签：

- 顺序
- 层级
- 并行
- 投票
- 辩论
- 共识

切换策略时：

- 保留 Workers，因为六种策略共享同一 Worker 注册表。
- 切到 `hierarchical` 时隐藏 Tasks 和 Judge，并保留不可见字段的原值，以便切回时不丢配置。
- 切到其他策略时隐藏 Manager。
- 在提交/保存前只清除与当前策略不兼容的字段，避免后端参数校验失败。
- 对无法满足预算的组合显示行内错误，不自行修改用户输入。

### 7.2 Manager

仅 `hierarchical` 显示，包含：

- 模型选择。
- 系统提示词。
- 最大反思轮数。
- 可选工具配置入口。

用户系统提示词保留原文。界面说明 Manager 会自动加入委派协议，不提供关闭该协议的开关。

### 7.3 Worker 列表

每个 Worker 卡片包含：

- `id`：必填、团队内唯一。
- `name`：显示名称。
- `role`：角色。
- `capabilities`：可增删标签。
- `description`：Manager 可读的能力说明。
- Agent 参数：模型、系统提示词、最大轮数、工具。

交互：

- 添加和删除 Worker。
- 卡片可折叠，默认展开第一个。
- 删除仍被 Task 或 Judge 引用的 Worker 时显示确认，并同时清除失效引用。
- 重复 ID 在卡片和列表级显示错误。
- 没有 Worker 时显示明确空状态和添加按钮。

### 7.4 Task 列表

仅非 `hierarchical` 策略显示。

顺序、并行、投票、辩论、共识共用 Task 结构。每个 Task 包含：

- Worker 选择器。
- 任务说明。
- 可选上下文。
- 预期输出。

交互：

- 添加、删除和重排任务。
- Task 顺序始终可编辑，因为 Sequential、Debate 和 Consensus 依赖稳定顺序。
- Worker 下拉只列出已注册 Worker。
- 删除 Worker 后，引用该 Worker 的 Task 显示无效选择，必须修复后才能保存。
- `vote` 和 `consensus` 在任务说明上方提示参与者必须返回 `choice`、`confidence`、`rationale` JSON。

### 7.5 Judge

仅 `vote`、`debate`、`consensus` 显示。

使用 Worker 选择器，并提供清空选项。Judge 下拉只列出当前 Workers。选择 `debate` 时说明 Judge 负责汇总；选择 `vote` 或 `consensus` 时说明 Judge 负责平局或未达成共识后的裁决。

### 7.6 运行约束

包含：

- `max_concurrency`，仅协作型策略显示。
- `collaboration_rounds`，仅 `debate` 和 `consensus` 显示。
- `max_delegations`。
- `max_depth`。
- `worker_timeout`。

每个数值字段显示后端接受的边界。`max_delegations` 下方实时显示当前策略的最坏调用次数和所需最小值。

### 7.7 输出契约

只展示后端稳定输出：

- `content`
- `structured`
- `delegations`
- `votes`
- `rounds`
- `consensus`
- `winner`
- `_ERROR`

输出区不可编辑，使用现有 `Output` 组件风格。

## 8. 校验

前端校验必须与后端语义一致，但后端仍是最终权威。

新增 `validation.ts`，返回结构化错误供 RHF 和行内提示消费：

- `workers` 非空。
- Worker `id` 非空且唯一。
- 每个 Worker 的 `agent.params.llm_id` 非空。
- `hierarchical` 必须有 Manager 模型。
- `hierarchical` 不允许非空 `tasks` 或 `judge`。
- 非 `hierarchical` 不允许非空 Manager。
- 非 `hierarchical` 的 `tasks` 非空。
- Task 的 `worker`、`task`、`expected_output` 非空。
- Task 的 `worker` 必须存在于 Worker 列表。
- `max_concurrency >= 1`。
- `collaboration_rounds >= 1`。
- `max_delegations >= 1`。
- `max_depth >= 1`。
- `worker_timeout > 0`。
- `judge` 非空时必须存在于 Worker 列表。
- `parallel` 不允许 Judge。
- `judge` 只能用于 `vote`、`debate`、`consensus`。

最坏预算：

```text
sequential     N
parallel       N
vote           N + J
debate         N * R + J
consensus      N * R + J
hierarchical   由运行时预算控制
```

其中 `N = tasks.length`，`R = collaboration_rounds`，`J = judge ? 1 : 0`。

预算不满足时，表单显示“至少需要 X 次委派”，并阻止保存/发布。后端校验错误仍通过现有通知机制展示。

## 9. DSL 与状态同步

`AgentTeam` 使用现有 `buildDslComponentsByGraph()` 路径：

```json
{
  "component_name": "AgentTeam",
  "params": {
    "process": "debate",
    "manager": {},
    "workers": [],
    "tasks": [],
    "max_concurrency": 2,
    "collaboration_rounds": 2,
    "judge": "",
    "max_delegations": 5,
    "max_depth": 2,
    "worker_timeout": 300,
    "custom_header": {}
  }
}
```

要求：

- 不增加 DSL 转换分支，除非现有通用分支会丢弃嵌套字段。
- `manager.params`、`workers[].agent.params`、`tasks` 和 `custom_header` 必须原样进入 DSL。
- `outputs` 是节点契约，不写入运行时值。
- `graphToDsl()` 和 `dslToGraph()` 必须支持导入、导出、复制和版本恢复。
- 表单通过 `useWatchFormChange()` 的语义同步到节点 `data.form`，不新增平行 Zustand slice。

## 10. 运行结果展示

### 10.1 数据来源

运行结果从 `NodeFinished` 事件的 `data.outputs` 读取。字段可能是直接对象或多次运行的数组；提供统一的 `normalizeAgentTeamOutput()` 处理：

- 取最后一次运行。
- 读取 `delegations`、`votes`、`rounds`、`winner`、`consensus` 和 `_ERROR`。
- 兼容 `structured` 是对象或 JSON 字符串的情况。
- 无法解析时显示原始 JSON，不吞掉错误。

### 10.2 通用运行时间线

在现有 `WorkFlowTimeline` 中，当 `component_type === "AgentTeam"` 时在标准输入/输出 JSON 之外渲染专用团队视图：

- 摘要：策略、耗时、状态、Worker 数。
- 委派时间线：按 `sequence`、`round`、`task_index` 排序；显示 Worker、任务、状态、耗时和结果。
- 投票视图：按 choice 分组，显示票数和置信度和；无效票单独标记。
- 轮次视图：按 round 分组，显示每个参与者的观点和错误。
- 结论卡片：显示 winner、consensus、resolution 和 Judge 结果。
- 失败状态：显示 `_ERROR`、失败 Worker 和预算耗尽提示。

其他节点仍使用现有 JSON 视图，不改变已有日志行为。

### 10.3 节点运行态

节点摘要从 `AgentInstanceContext` 读取当前节点是否正在运行。运行完成后可从最近事件推导成功、部分成功或失败状态；没有事件时显示“未运行”。

## 11. 设计要求

- 沿用 `src/tailwind.css` 中定义的 `bg-bg-base`、`bg-bg-card`、`text-text-primary`、`text-text-secondary`、`border-border-button` 等 token。
- 使用项目现有 `Button`、`Card`、`Collapse`、`SelectWithSearch`、`NumberInput`、`Textarea`、`Badge` 等组件。
- 不修改 `src/components/ui/`。
- Worker 卡片和 Task 卡片圆角不超过 `8px`。
- 状态色只使用项目状态 token，不直接写 Tailwind 调色板颜色。
- 删除、添加、折叠和重排按钮使用 lucide 图标并提供 tooltip。
- 桌面和窄屏表单均不出现文字遮挡；Worker/Task 头部允许换行或截断。
- 键盘焦点可见，折叠按钮和下拉菜单可通过键盘操作。
- 不对新页面引入大面积装饰、渐变或动画。

## 12. 错误处理

- Worker 列表为空：阻止保存并显示添加入口。
- 重复 Worker ID：卡片边框和字段 message 同时提示。
- Task 引用失效：Worker 选择器显示错误态。
- 预算不足：在运行约束区和保存按钮附近显示所需值。
- Manager/Tasks/Judge 组合不兼容：在相关区域显示具体原因。
- 后端保存失败：保留表单内容，不清空本地配置，沿用现有通知。
- 运行失败：保留审计记录和原始输出，错误文本不截断为不可恢复内容。
- 结果部分失败：使用“部分成功”状态，不把整个团队显示成全失败。

## 13. 代码边界

### 13.1 常量与类型

修改：

- `web/src/constants/agent.tsx`：新增 `Operator.AgentTeam`。
- `web/src/pages/agent/constant/index.tsx`：新增 `initialAgentTeamValues`、`NodeMap` 和连接限制。
- `web/src/interfaces/database/agent.ts`：新增 `IAgentTeamForm` 及相关类型。

### 13.2 画布

新增：

- `web/src/pages/agent/canvas/node/agent-team-node.tsx`

修改：

- `web/src/pages/agent/canvas/index.tsx`：注册 `agentTeamNode`。
- `web/src/pages/agent/canvas/node/dropdown/accordion-operators.tsx`：加入基础分组。
- `web/src/components/operator-icon.tsx`：增加团队图标映射。
- `web/src/pages/agent/hooks/use-add-node.ts`：增加初始参数映射。

### 13.3 表单

新增 `agent-team-form` 目录，并按第 7 节拆分组件。表单只负责配置编辑和前端校验，不执行团队策略。

修改：

- `web/src/pages/agent/form-sheet/form-config-map.tsx`：映射 `AgentTeam` 到新表单。

### 13.4 运行结果

新增：

- `web/src/pages/agent/log-sheet/agent-team-timeline.tsx`
- `web/src/pages/agent/log-sheet/agent-team-output.ts`（纯归一化和分组逻辑）

修改：

- `web/src/pages/agent/log-sheet/workflow-timeline.tsx`：对 `AgentTeam` 渲染专用视图。

### 13.5 国际化

修改：

- `web/src/locales/en.ts`
- `web/src/locales/zh.ts`

新增 `flow.agentTeam` 命名空间，涵盖策略、字段、提示、校验和运行结果文案。其他语言不自动扩写。

## 14. 测试

### 14.1 纯函数测试

新增 `validation.test.ts`，覆盖：

- 六种策略的合法配置。
- Manager/Tasks/Judge 组合约束。
- Worker ID 重复。
- Task 引用失效。
- Judge 引用失效。
- 每种策略的预算计算和边界。
- 数字下界。

新增 `agent-team-output.test.ts`，覆盖：

- 单次和多次运行输出归一化。
- `structured` 为字符串时解析。
- 委派记录排序。
- 投票分组和无效票。
- 缺失字段的空状态。
- `_ERROR` 保留。

### 14.2 组件测试

新增：

- `process-selector.test.tsx`：策略切换后显示/隐藏正确区域。
- `worker-list.test.tsx`：添加、删除、重复 ID 和引用清理。
- `task-list.test.tsx`：添加、删除、重排和无效 Worker。
- `agent-team-timeline.test.tsx`：显示并行部分失败、投票、辩论轮次和共识结论。

### 14.3 DSL 回归

- 导入含 `AgentTeam` 的 DSL 后节点类型、表单值和参数不丢失。
- 保存后 `components[id].obj.component_name === "AgentTeam"`。
- `manager.params`、`workers[].agent.params` 和 `tasks` 完整保留。
- 导出后重新导入，配置保持一致。

### 14.4 验证命令

```bash
cd web
npm run type-check
npm run lint
npm run test -- --runInBand
npm run build
```

优先运行改动目录相关测试；最后运行完整类型检查、lint 和构建。

## 15. 验收标准

- 用户可以从画布新增 `AgentTeam` 节点。
- 六种策略都能在表单中选择并保存。
- `hierarchical` 能配置 Manager；其他策略能配置 Tasks。
- 可新增、编辑、删除和重排 Workers 与 Tasks。
- Vote、Debate 和 Consensus 可配置 Judge；Parallel 不可配置 Judge。
- 前端能阻止空 Worker、重复 ID、失效引用和预算不足。
- 保存后的 DSL 与后端 `AgentTeamParam` 合同一致。
- 节点显示策略、Worker 数量和运行状态。
- 运行日志显示委派时间线、投票、轮次、winner、consensus、resolution 和错误。
- 导入、导出、复制和恢复画布不会丢失团队配置。
- 中英文文案完整，其他语言回退英文。
- 不修改共享 UI 库，不引入第二套状态或执行器。
- `npm run type-check`、`npm run lint`、相关 Jest 测试和 `npm run build` 通过。
