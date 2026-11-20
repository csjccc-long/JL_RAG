import { fireEvent, render, screen } from '@testing-library/react';
import { IFlow } from '@/interfaces/database/agent';
import TeamPicker from './team-picker';
import { IAgentTeamSummary } from './utils/extract-teams';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./team-fan', () => ({
  playFanSound: jest.fn(),
}));

const buildTeam = (): IAgentTeamSummary => ({
  agentId: 'agent-1',
  agentTitle: '供应链团队',
  componentId: 'AgentTeam:1',
  process: 'parallel',
  workers: [
    { id: 'w1', name: 'Ada Lovelace', role: '', agent: { params: {} }, capabilities: [], description: '' },
  ],
  tasks: [],
  judge: '',
  managerLlmId: '',
  maxDelegations: 8,
  maxDepth: 3,
});

const roster = [
  { id: 'w1', title: 'Ada Lovelace', description: '数学' },
  { id: 'w2', title: 'Alan Turing', description: '计算' },
] as unknown as IFlow[];

describe('TeamPicker', () => {
  it('shows who is already on the team', () => {
    render(<TeamPicker team={buildTeam()} roster={roster} onAssign={jest.fn()} />);
    expect(document.querySelectorAll('.pk-face')).toHaveLength(1);
    expect(screen.getByTitle('Ada Lovelace')).toBeInTheDocument();
  });

  it('offers existing agents and adds the one that is picked', () => {
    const onAssign = jest.fn();
    render(<TeamPicker team={buildTeam()} roster={roster} onAssign={onAssign} />);

    fireEvent.click(document.querySelector('.pk-pill') as Element);
    const rows = document.querySelectorAll('.pk-row');
    expect(rows).toHaveLength(2);

    fireEvent.click(rows[1]);
    expect(onAssign).toHaveBeenCalledWith(['w1', 'w2']);
  });

  it('removes an agent that is already on the team', () => {
    const onAssign = jest.fn();
    render(<TeamPicker team={buildTeam()} roster={roster} onAssign={onAssign} />);

    fireEvent.click(document.querySelector('.pk-pill') as Element);
    fireEvent.click(document.querySelectorAll('.pk-row')[0]);
    expect(onAssign).toHaveBeenCalledWith([]);
  });

  it('shows three faces at most and counts the rest', () => {
    const team = buildTeam();
    team.workers = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => ({
      id,
      name: id,
      role: '',
      agent: { params: {} },
      capabilities: [],
      description: '',
    }));
    render(<TeamPicker team={team} roster={roster} onAssign={jest.fn()} />);

    expect(document.querySelectorAll('.pk-rail .pk-face')).toHaveLength(3);
    expect(document.querySelector('.pk-behind')?.textContent).toBe('+2');
  });

  it('draws the faces without any text on them', () => {
    render(<TeamPicker team={buildTeam()} roster={roster} onAssign={jest.fn()} />);
    expect(document.querySelector('.pk-face')?.textContent).toBe('');
  });

  it('does not select the team when the pill is pressed', () => {
    const onSelect = jest.fn();
    render(
      <div onClick={onSelect}>
        <TeamPicker team={buildTeam()} roster={roster} onAssign={jest.fn()} />
      </div>,
    );
    fireEvent.click(document.querySelector('.pk-pill') as Element);
    expect(onSelect).not.toHaveBeenCalled();
  });
});