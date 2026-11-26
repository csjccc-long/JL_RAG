import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockRun = jest.fn();
const mockStop = jest.fn();

// jest.mock 的工厂会被提升到文件顶部，工厂里只能引用 mock* 前缀的变量。
let mockSearchParams = new URLSearchParams();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./vote-core-visual', () => ({
  __esModule: true,
  default: () => <div data-testid="vote-core-visual" />,
}));

jest.mock('react-router', () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [mockSearchParams, jest.fn()],
}));

// 页面只用到 Routes.Chats 这一个常量；直接 mock 掉路由表，避免在单测里
// 求值整棵路由树（它会实例化 createBrowserRouter 并渲染所有懒加载路由）。
jest.mock('@/routes', () => ({
  Routes: { Chats: '/chats' },
}));

// 页面挂着的成员/协作方式两个 Hook 都会走这个 service；被测的只是页面本身，
// 不该把 next-request 和它初始化的 i18n 单例一起拖进来。
jest.mock('@/services/agent-service', () => ({
  __esModule: true,
  default: { getAgent: jest.fn(), listAgents: jest.fn() },
  updateAgent: jest.fn(),
}));

jest.mock('./hooks/use-agent-roster', () => ({
  useAgentRoster: () => ({ roster: [] }),
}));

jest.mock('./hooks/use-assign-workers', () => ({
  useAssignWorkers: () => ({
    mutate: jest.fn(),
    isPending: false,
    error: undefined,
    variables: undefined,
  }),
}));

jest.mock('./hooks/use-set-process', () => ({
  useSetProcess: () => ({ mutate: jest.fn(), isPending: false, error: undefined }),
}));

jest.mock('./process-menu', () => ({
  __esModule: true,
  default: () => <div data-testid="process-menu" />,
  PROCESS_ICONS: {},
}));

// 新建团队对话框自己带 mutation 与查询客户端；页面用例只需要它别在挂载时
// 去取 QueryClient（页面在测试里不在 Provider 内）。
jest.mock('./hooks/use-create-team', () => ({
  useCreateTeam: () => ({ mutate: jest.fn(), isPending: false, error: undefined }),
}));

const buildTeam = (overrides: Record<string, any> = {}) => ({
  agentId: 'agent-1',
  agentTitle: '供应链团队',
  componentId: 'AgentTeam:1',
  process: 'hierarchical',
  workers: [
    { id: 'worker_1', name: '调研员', role: '', capabilities: [], description: '' },
  ],
  tasks: [
    {
      task: '调研供应商风险',
      worker: 'worker_1',
      context: '',
      expected_output: '',
    },
  ],
  judge: '',
  managerLlmId: 'qwen',
  maxDelegations: 8,
  maxDepth: 3,
  ...overrides,
});

let mockTeams = [buildTeam()];

jest.mock('./hooks/use-agent-teams', () => ({
  useAgentTeams: () => ({
    teams: mockTeams,
    loading: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('./hooks/use-team-progress', () => ({
  useTeamProgress: () => ({ progress: [] }),
}));

jest.mock('./hooks/use-team-run', () => ({
  useTeamRun: () => ({
    run: mockRun,
    stop: mockStop,
    running: false,
    taskId: 'task-1',
    snapshot: undefined,
    answer: '',
    error: undefined,
  }),
}));

jest.mock('./team-list', () => ({
  __esModule: true,
  default: () => <div data-testid="team-list" />,
  teamKey: (value: { agentId: string; componentId: string }) =>
    `${value.agentId}:${value.componentId}`,
}));

jest.mock('./dispatch-board', () => ({
  __esModule: true,
  default: () => <div data-testid="dispatch-board" />,
}));

jest.mock('./result-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="result-panel" />,
}));

import AgentTeamPage from './index';

describe('AgentTeamPage', () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockStop.mockClear();
    mockTeams = [buildTeam()];
    mockSearchParams = new URLSearchParams(
      'task=帮我分别调研供应链风险&auto=1',
    );
  });

  it('keeps the board and the result behind the bottom dock', () => {
    render(<AgentTeamPage />);
    // 团队栏也收起来了：默认只剩左边缘的竖标签，指上去才铺开。
    expect(screen.queryByTestId('team-list')).not.toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('team-hover'));
    expect(screen.getByTestId('team-list')).toBeInTheDocument();
    // 看板和结论都不再常驻：默认只留底部工作条，点哪块才铺出哪块。
    expect(screen.queryByTestId('dispatch-board')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dispatch-dock-toggle'));
    expect(screen.getByTestId('dispatch-board')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('result-dock-toggle'));
    expect(screen.getByTestId('result-panel')).toBeInTheDocument();
  });

  it('keeps the dial and puts the vote orbit in the middle', async () => {
    mockTeams = [buildTeam({ process: 'vote' })];
    mockSearchParams = new URLSearchParams();
    render(<AgentTeamPage />);

    // 分发盘始终在右上角；投票模式只是在中间空区多一张纯色圆盘。
    await waitFor(() =>
      expect(screen.getByTestId('vote-orbit')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('vote-stage')).toBeInTheDocument();
    expect(screen.getByTestId('vote-disc')).toBeInTheDocument();
    expect(screen.getByTestId('result-dial')).toBeInTheDocument();
  });

  it('prefills the task from the url query', () => {
    render(<AgentTeamPage />);
    expect(
      screen.getByDisplayValue('帮我分别调研供应链风险'),
    ).toBeInTheDocument();
  });

  it('auto runs the selected team once when auto=1', async () => {
    render(<AgentTeamPage />);
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledWith('agent-1', '帮我分别调研供应链风险'),
    );
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('prefers the hierarchical team when the task comes from chat', async () => {
    mockTeams = [
      buildTeam({ agentId: 'agent-parallel', process: 'parallel' }),
      buildTeam({ agentId: 'agent-boss', process: 'hierarchical' }),
    ];
    render(<AgentTeamPage />);
    await waitFor(() =>
      expect(mockRun).toHaveBeenCalledWith('agent-boss', '帮我分别调研供应链风险'),
    );
  });

  it('does not auto run when auto is absent', async () => {
    mockSearchParams = new URLSearchParams('task=帮我分别调研供应链风险');
    render(<AgentTeamPage />);
    await waitFor(() =>
      expect(screen.getByTestId('dispatch-dock-toggle')).toBeInTheDocument(),
    );
    expect(mockRun).not.toHaveBeenCalled();
  });
});