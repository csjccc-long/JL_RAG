import { fireEvent, render, screen } from '@testing-library/react';
import TeamCard from './team-card';
import { IAgentTeamSummary } from './utils/extract-teams';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const buildTeam = (): IAgentTeamSummary => ({
  agentId: 'agent-1',
  agentTitle: '供应链团队',
  componentId: 'AgentTeam:1',
  process: 'hierarchical',
  workers: [
    { id: 'w1', name: 'Ada Lovelace', role: '', agent: { params: {} }, capabilities: [], description: '' },
    { id: 'w2', name: 'Alan Turing', role: '', agent: { params: {} }, capabilities: [], description: '' },
    { id: 'w3', name: 'Grace Hopper', role: '', agent: { params: {} }, capabilities: [], description: '' },
    { id: 'w4', name: 'Linus Pauling', role: '', agent: { params: {} }, capabilities: [], description: '' },
  ],
  tasks: [],
  judge: '',
  managerLlmId: '',
  maxDelegations: 8,
  maxDepth: 3,
});

const teamKey = (team: IAgentTeamSummary) =>
  `${team.agentId}:${team.componentId}`;

describe('TeamCard', () => {
  it('shows the team and the crew as faces', () => {
    render(
      <TeamCard
        team={buildTeam()}
        active={false}
        onSelect={jest.fn()}
        onOpenCanvas={jest.fn()}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );
    expect(screen.getByText('供应链团队')).toBeInTheDocument();
    // four workers, but the pill only ever shows three faces and counts the rest
    expect(document.querySelectorAll('.pk-face')).toHaveLength(3);
    expect(document.querySelector('.pk-behind')?.textContent).toBe('+1');
  });

  it('selects the team when the card is clicked', () => {
    const onSelect = jest.fn();
    render(
      <TeamCard
        team={buildTeam()}
        active={false}
        onSelect={onSelect}
        onOpenCanvas={jest.fn()}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('team-card'));
    expect(onSelect).toHaveBeenCalledWith(buildTeam(), 'agent-1:AgentTeam:1');
  });

  it('opens the canvas from the fan without re-selecting the team', () => {
    const onSelect = jest.fn();
    const onOpenCanvas = jest.fn();
    render(
      <TeamCard
        team={buildTeam()}
        active={false}
        onSelect={onSelect}
        onOpenCanvas={onOpenCanvas}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );
    fireEvent.pointerEnter(screen.getByTestId('team-card'));
    const buttons = document.querySelectorAll('.nod-act');
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[0]);
    expect(onOpenCanvas).toHaveBeenCalledWith(buildTeam());
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('does not open the fan when the crew picker is the thing being hovered', () => {
    render(
      <TeamCard
        team={buildTeam()}
        active={false}
        onSelect={jest.fn()}
        onOpenCanvas={jest.fn()}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );

    /* reaching for a member must not light up the card's own actions */
    fireEvent.pointerOver(document.querySelector('.pk-pill') as Element);
    expect(document.querySelectorAll('.nod-act')).toHaveLength(0);

    /* and the card itself still answers */
    fireEvent.pointerOver(screen.getByTestId('team-card'));
    expect(document.querySelectorAll('.nod-act')).toHaveLength(3);
  });
  it('draws only the faces a small crew actually has', () => {
    const one = { ...buildTeam(), workers: buildTeam().workers.slice(0, 1) };
    const { unmount } = render(
      <TeamCard
        team={one}
        active={false}
        onSelect={jest.fn()}
        onOpenCanvas={jest.fn()}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );

    /* fewer than three members must not leave two empty seats behind them */
    expect(document.querySelectorAll('.pk-face')).toHaveLength(1);
    expect(document.querySelector('.pk-behind')).toBeNull();
    expect((document.querySelector('.pk-rail') as HTMLElement).style.width).toBe(
      '26px',
    );
    unmount();

    const two = { ...buildTeam(), workers: buildTeam().workers.slice(0, 2) };
    render(
      <TeamCard
        team={two}
        active={false}
        onSelect={jest.fn()}
        onOpenCanvas={jest.fn()}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );
    expect(document.querySelectorAll('.pk-face')).toHaveLength(2);
    expect(document.querySelector('.pk-behind')).toBeNull();
    expect((document.querySelector('.pk-rail') as HTMLElement).style.width).toBe(
      '43px',
    );
  });

  it('stops at three faces once the crew is exactly three', () => {
    const three = { ...buildTeam(), workers: buildTeam().workers.slice(0, 3) };
    render(
      <TeamCard
        team={three}
        active={false}
        onSelect={jest.fn()}
        onOpenCanvas={jest.fn()}
        teamKey={teamKey}
        roster={[]}
        onAssign={jest.fn()}
      />,
    );
    expect(document.querySelectorAll('.pk-face')).toHaveLength(3);
    expect(document.querySelector('.pk-behind')).toBeNull();
  });
});

