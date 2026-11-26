import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./dispatch-board', () => ({
  __esModule: true,
  default: () => <div data-testid="dispatch-board" />,
}));

jest.mock('./result-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="result-panel" />,
}));

import WorkbenchDock from './workbench-dock';
import { ITeamBoardCard } from './utils/board';
import { ITeamRunSnapshot } from './hooks/use-team-run';

const card = (id: string, status: ITeamBoardCard['status']): ITeamBoardCard => ({
  id,
  workerId: `worker_${id}`,
  workerName: `成员${id}`,
  role: '',
  task: '调研供应商风险',
  status,
  round: 1,
  taskIndex: 0,
  elapsedMs: null,
  error: '',
  result: '',
  source: 'plan',
});

const cards = [
  card('1', 'pending'),
  card('2', 'running'),
  card('3', 'done'),
  card('4', 'failed'),
];

const snapshot: ITeamRunSnapshot = {
  componentId: 'AgentTeam:1',
  outputs: { structured: { summary: '供应链风险可控' } },
  error: '',
  elapsedMs: 1200,
};

const renderDock = (overrides: Record<string, unknown> = {}) =>
  render(
    <WorkbenchDock
      cards={cards}
      answer=""
      error=""
      running={false}
      {...overrides}
    />,
  );

describe('WorkbenchDock', () => {
  it('默认收起，只把四类状态的计数摊在条上', () => {
    renderDock();

    expect(screen.queryByTestId('dispatch-dock-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('result-dock-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('dispatch-count-pending')).toHaveTextContent('1');
    expect(screen.getByTestId('dispatch-count-running')).toHaveTextContent('1');
    expect(screen.getByTestId('dispatch-count-done')).toHaveTextContent('1');
    expect(screen.getByTestId('dispatch-count-failed')).toHaveTextContent('1');
    expect(screen.getByTestId('dispatch-dock-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTestId('result-dock-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('点状态开看板，点结果开结论，两块同一时间只开一块', () => {
    renderDock();

    fireEvent.click(screen.getByTestId('dispatch-dock-toggle'));
    expect(screen.getByTestId('dispatch-dock-panel')).toBeInTheDocument();
    expect(screen.getByTestId('dispatch-board')).toBeInTheDocument();
    expect(screen.queryByTestId('result-dock-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('result-dock-toggle'));
    expect(screen.queryByTestId('dispatch-dock-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('result-dock-panel')).toBeInTheDocument();
    expect(screen.getByTestId('result-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('result-dock-toggle'));
    expect(screen.queryByTestId('result-dock-panel')).not.toBeInTheDocument();
  });

  it('展开后按 Escape 收起', () => {
    renderDock();
    fireEvent.click(screen.getByTestId('result-dock-toggle'));
    expect(screen.getByTestId('result-dock-panel')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('result-dock-panel')).not.toBeInTheDocument();
  });

  it('运行结束时自动弹出结论', () => {
    const { rerender } = renderDock({ running: true, snapshot });

    expect(screen.queryByTestId('result-dock-panel')).not.toBeInTheDocument();

    rerender(
      <WorkbenchDock
        cards={cards}
        snapshot={snapshot}
        answer=""
        error=""
        running={false}
      />,
    );

    expect(screen.getByTestId('result-dock-panel')).toBeInTheDocument();
    expect(screen.getByTestId('result-panel')).toBeInTheDocument();
    expect(screen.getByTestId('result-dock-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('会话创建失败只落 error 时也自动弹出结论', () => {
    renderDock({ error: '创建会话失败' });

    expect(screen.getByTestId('result-dock-panel')).toBeInTheDocument();
  });

  it('挂载时已有旧结果但这次没有开跑，不自动弹出', () => {
    renderDock({ snapshot });

    expect(screen.queryByTestId('result-dock-panel')).not.toBeInTheDocument();
  });
});
