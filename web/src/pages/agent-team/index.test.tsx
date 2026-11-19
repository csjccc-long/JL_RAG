import { render, screen, waitFor } from '@testing-library/react';

const mockRun = jest.fn();
const mockStop = jest.fn();

// jest.mock 的工厂会被提升到文件顶部，工厂里只能引用 mock* 前缀的变量。
let mockSearchParams = new URLSearchParams();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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

  it('renders the three panels', () => {
    render(<AgentTeamPage />);
    expect(screen.getByTestId('team-list')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-board')).toBeInTheDocument();
    expect(screen.getByTestId('result-panel')).toBeInTheDocument();
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
      expect(screen.getByTestId('dispatch-board')).toBeInTheDocument(),
    );
    expect(mockRun).not.toHaveBeenCalled();
  });
});