import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./team-list', () => ({
  __esModule: true,
  default: ({
    onSelect,
  }: {
    onSelect: (team: unknown, key: string) => void;
  }) => (
    <button
      type="button"
      data-testid="pick-team"
      onClick={() => onSelect({ agentId: 'agent-1' }, 'agent-1:AgentTeam:1')}
    >
      pick
    </button>
  ),
}));

import TeamHover from './team-hover';

const renderTeamHover = (
  overrides: Partial<ComponentProps<typeof TeamHover>> = {},
) =>
  render(
    <TeamHover
      teams={[]}
      loading={false}
      roster={[]}
      onSelect={jest.fn()}
      onOpenCanvas={jest.fn()}
      onAssign={jest.fn()}
      onRetry={jest.fn()}
      onCreate={jest.fn()}
      {...overrides}
    />,
  );

describe('TeamHover', () => {
  it('stays collapsed until the pointer enters', () => {
    renderTeamHover();
    expect(screen.queryByTestId('team-hover-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('team-hover-trigger')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.mouseEnter(screen.getByTestId('team-hover'));
    expect(screen.getByTestId('team-hover-panel')).toBeInTheDocument();
    expect(screen.getByTestId('team-hover-trigger')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('collapses when the pointer leaves even if the trigger kept focus', () => {
    renderTeamHover();
    const trigger = screen.getByTestId('team-hover-trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId('team-hover-panel')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('team-hover'));
    expect(screen.queryByTestId('team-hover-panel')).not.toBeInTheDocument();
  });

  it('toggles from the trigger and closes on Escape', () => {
    renderTeamHover();
    fireEvent.click(screen.getByTestId('team-hover-trigger'));
    expect(screen.getByTestId('team-hover-panel')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('team-hover-panel')).not.toBeInTheDocument();
  });

  it('closes after a team is picked', () => {
    const onSelect = jest.fn();
    renderTeamHover({ onSelect });
    fireEvent.mouseEnter(screen.getByTestId('team-hover'));
    fireEvent.click(screen.getByTestId('pick-team'));

    expect(onSelect).toHaveBeenCalledWith(
      { agentId: 'agent-1' },
      'agent-1:AgentTeam:1',
    );
    expect(screen.queryByTestId('team-hover-panel')).not.toBeInTheDocument();
  });
});
