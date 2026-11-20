import { fireEvent, render, screen } from '@testing-library/react';
import ProcessMenu from './process-menu';

const dict: Record<string, string> = {
  'flow.agentTeam.page.processLabel': '协作方式',
  'flow.agentTeam.page.processHint': '执行前可以切换协作方式',
  'flow.agentTeam.page.processLocked': '协作进行中，先停止才能切换协作方式',
  'flow.agentTeam.process.sequential.label': '顺序执行',
  'flow.agentTeam.process.hierarchical.label': '层级协作',
  'flow.agentTeam.process.parallel.label': '并行执行',
  'flow.agentTeam.process.vote.label': '投票',
  'flow.agentTeam.process.debate.label': '辩论',
  'flow.agentTeam.process.consensus.label': '共识',
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => dict[key] ?? key,
  }),
}));

jest.mock('./team-fan', () => ({ playFanSound: jest.fn() }));

describe('ProcessMenu', () => {
  it('shows the current mode and opens all six, ticking the one in use', () => {
    render(<ProcessMenu value="parallel" onChange={jest.fn()} />);

    const pill = screen.getByRole('button', { name: /并行执行/ });
    expect(pill).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(pill);

    expect(pill).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.textContent)).toEqual([
      '顺序执行',
      '层级协作',
      '并行执行',
      '投票',
      '辩论',
      '共识',
    ]);
    expect(rows[2]).toHaveAttribute('aria-checked', 'true');
    expect(rows[3]).toHaveAttribute('aria-checked', 'false');
  });

  it('switches the mode and folds the panel away', () => {
    const onChange = jest.fn();
    render(<ProcessMenu value="parallel" onChange={onChange} />);

    const pill = screen.getByRole('button', { name: /并行执行/ });
    fireEvent.click(pill);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '投票' }));

    expect(onChange).toHaveBeenCalledWith('vote');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not report a switch when the mode picked is the current one', () => {
    const onChange = jest.fn();
    render(<ProcessMenu value="vote" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /投票/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '投票' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('locks while a run is in flight', () => {
    render(<ProcessMenu value="hierarchical" locked onChange={jest.fn()} />);

    const pill = screen.getByRole('button', { name: /层级协作/ });
    expect(pill).toBeDisabled();
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });
});
