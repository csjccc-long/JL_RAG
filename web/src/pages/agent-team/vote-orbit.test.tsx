import { render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// jsdom 没有 WebGL；中心的核心只验证挂载位置，不加载 three 的 ESM 包。
jest.mock('./vote-core-visual', () => ({
  __esModule: true,
  default: () => <div data-testid="vote-core-visual" />,
}));

import VoteOrbit, { buildVoteAgents, voteAgentStatus } from './vote-orbit';
import { ITeamBoardCard } from './utils/board';

const worker = (id: string, name: string) => ({
  id,
  name,
  agent: { params: {} },
});

const card = (
  workerId: string,
  status: ITeamBoardCard['status'],
): ITeamBoardCard => ({
  id: `${workerId}-${status}`,
  workerId,
  workerName: workerId,
  role: '',
  task: '评审供应商风险',
  status,
  round: 1,
  taskIndex: 0,
  elapsedMs: null,
  error: '',
  result: '',
  source: 'live',
});

describe('voteAgentStatus', () => {
  it('running 卡优先，失败次之', () => {
    expect(
      voteAgentStatus({
        cards: [card('w1', 'running'), card('w1', 'failed')],
        running: true,
      }),
    ).toBe('running');
    expect(
      voteAgentStatus({
        cards: [card('w1', 'done'), card('w1', 'failed')],
        running: true,
      }),
    ).toBe('failed');
  });

  it('自己的票投完但整队还在跑 = 等待结果，整队停下 = 已完成', () => {
    const cards = [card('w1', 'done')];
    expect(voteAgentStatus({ cards, running: true })).toBe('waitingResult');
    expect(voteAgentStatus({ cards, running: false })).toBe('done');
  });

  it('没有任务或还没轮到自己时都在等待任务', () => {
    expect(voteAgentStatus({ cards: [], running: true })).toBe('waiting');
    expect(
      voteAgentStatus({ cards: [card('w1', 'pending')], running: false }),
    ).toBe('waiting');
  });
});

describe('buildVoteAgents', () => {
  it('以队伍名单为准，没分到任务的人也留在盘上', () => {
    const agents = buildVoteAgents({
      workers: [worker('w1', '财务评审'), worker('w2', '法务评审')],
      cards: [card('w1', 'done')],
      running: false,
    });

    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({ name: '财务评审', status: 'done' });
    expect(agents[1]).toMatchObject({ name: '法务评审', status: 'waiting' });
  });

  it('没有 workers 时用看板里出现的成员兜底', () => {
    const agents = buildVoteAgents({
      workers: [],
      cards: [card('w1', 'running')],
      running: true,
    });

    expect(agents).toEqual([
      expect.objectContaining({
        workerId: 'w1',
        name: 'w1',
        status: 'running',
      }),
    ]);
  });
});

describe('VoteOrbit', () => {
  const workers = [
    worker('w1', '财务评审'),
    worker('w2', '法务评审'),
    worker('w3', '技术评审'),
    worker('w4', '业务评审'),
  ];
  const cards = [
    card('w1', 'running'),
    card('w2', 'done'),
    card('w3', 'pending'),
    card('w4', 'failed'),
  ];

  it('调度盘有 4 个成员端口和 28 个背景端点，连线分深浅两层', () => {
    render(<VoteOrbit workers={workers} cards={cards} running />);

    expect(screen.getByTestId('vote-disc')).toBeInTheDocument();
    expect(screen.getByTestId('vote-core-visual')).toBeInTheDocument();
    expect(screen.getByTestId('vote-ring')).toBeInTheDocument();
    expect(
      screen.getByTestId('vote-ring').querySelectorAll('line'),
    ).toHaveLength(0);
    expect(screen.getByTestId('vote-particles')).toBeInTheDocument();
    expect(screen.getAllByTestId('vote-background-port')).toHaveLength(28);
    const nodeCount = workers.length + 28;
    const links = screen.getAllByTestId('vote-link');
    expect(links).toHaveLength(nodeCount * (nodeCount - 1));
    const upper = links.filter(
      (link) => link.getAttribute('data-layer') === 'upper',
    );
    const base = links.filter(
      (link) => link.getAttribute('data-layer') === 'base',
    );
    expect(upper).toHaveLength(236);
    expect(base).toHaveLength(756);
    expect(
      Number(upper[0].getAttribute('stroke-opacity')),
    ).toBeGreaterThan(Number(base[0].getAttribute('stroke-opacity')));

    expect(screen.getByTestId('vote-agent-w1')).toHaveAttribute(
      'data-status',
      'running',
    );
    expect(screen.getByTestId('vote-agent-w1')).toHaveTextContent('财务评审');
    expect(screen.getByTestId('vote-agent-w1')).toHaveTextContent(
      'flow.agentTeam.page.workerStatus.running',
    );
    expect(screen.getByTestId('vote-agent-w2')).toHaveTextContent(
      'flow.agentTeam.page.workerStatus.waitingResult',
    );
    expect(screen.getByTestId('vote-agent-w3')).toHaveTextContent(
      'flow.agentTeam.page.workerStatus.waiting',
    );
    expect(screen.getByTestId('vote-agent-w4')).toHaveTextContent(
      'flow.agentTeam.page.workerStatus.failed',
    );
  });

  it('运行结束后已投完的成员从等待结果切成已完成', () => {
    const { rerender } = render(
      <VoteOrbit workers={workers} cards={cards} running />,
    );
    expect(screen.getByTestId('vote-agent-w2')).toHaveAttribute(
      'data-status',
      'waitingResult',
    );

    rerender(<VoteOrbit workers={workers} cards={cards} running={false} />);
    expect(screen.getByTestId('vote-agent-w2')).toHaveAttribute(
      'data-status',
      'done',
    );
  });
});
