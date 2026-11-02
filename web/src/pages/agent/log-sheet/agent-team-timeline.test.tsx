import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { AgentTeamTimeline } from './agent-team-timeline';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

describe('AgentTeamTimeline', () => {
  it('renders partial failures and delegation details', () => {
    render(
      createElement(AgentTeamTimeline, {
        elapsedTime: 12.5,
        outputs: {
          process: 'parallel',
          status: 'partial',
          _ERROR: 'one worker failed',
          delegations: [
            {
              sequence: 1,
              worker_id: 'researcher',
              task: 'Collect evidence',
              status: 'ok',
              result: 'Evidence collected',
              duration_ms: 420,
            },
            {
              sequence: 2,
              worker_id: 'writer',
              task: 'Draft answer',
              status: 'error',
              error: 'timeout',
              duration_ms: 30000,
            },
          ],
        },
      }),
    );

    expect(
      screen.getByText('flow.agentTeam.timeline.delegations'),
    ).toBeInTheDocument();
    expect(screen.getByText('researcher')).toBeInTheDocument();
    expect(screen.getByText('Collect evidence')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument();
    expect(screen.getByText('one worker failed')).toBeInTheDocument();
  });

  it('renders vote totals, rounds, and a judge conclusion', () => {
    render(
      createElement(AgentTeamTimeline, {
        outputs: {
          process: 'consensus',
          winner: 'approve',
          consensus: false,
          resolution: 'judge',
          judge_result: 'Judge selected approve.',
          votes: [
            {
              worker_id: 'reviewer-a',
              choice: 'approve',
              confidence: 0.9,
              status: 'valid',
            },
            {
              worker_id: 'reviewer-b',
              choice: 'reject',
              confidence: 0.8,
              status: 'valid',
            },
          ],
          rounds: [
            {
              round: 1,
              responses: [
                {
                  worker_id: 'reviewer-a',
                  task_index: 0,
                  status: 'ok',
                  content: 'Approve with constraints.',
                },
              ],
            },
          ],
        },
      }),
    );

    expect(screen.getByText('flow.agentTeam.timeline.votes')).toBeInTheDocument();
    expect(screen.getByText('approve')).toBeInTheDocument();
    expect(screen.getByText('reject')).toBeInTheDocument();
    expect(screen.getByText('Approve with constraints.')).toBeInTheDocument();
    expect(screen.getByText('Judge selected approve.')).toBeInTheDocument();
  });

  it('renders a tie-break conclusion when consensus was not reported', () => {
    render(
      createElement(AgentTeamTimeline, {
        outputs: {
          process: 'debate',
          tie_break: 'Judge chose proposal B.',
        },
      }),
    );

    expect(
      screen.getByText('flow.agentTeam.timeline.conclusion'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/flow\.agentTeam\.timeline\.tieBreakValue/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/flow\.agentTeam\.timeline\.consensusValue/),
    ).not.toBeInTheDocument();
  });

  it('shows a failed status when execution failed without outputs', () => {
    render(
      createElement(AgentTeamTimeline, {
        outputs: {},
        error: 'worker timed out',
      }),
    );

    expect(
      screen.getByText('flow.agentTeam.timeline.status.failed'),
    ).toBeInTheDocument();
    expect(screen.getByText('worker timed out')).toBeInTheDocument();
  });
});
