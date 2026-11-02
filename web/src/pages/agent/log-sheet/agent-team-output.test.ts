import { normalizeAgentTeamOutput } from './agent-team-output';

describe('normalizeAgentTeamOutput', () => {
  it('uses the last run and parses structured JSON', () => {
    const result = normalizeAgentTeamOutput([
      { winner: 'old' },
      {
        winner: 'new',
        structured: '{"resolution":"judge","status":"partial"}',
        _ERROR: 'worker failed',
        delegations: [
          { worker_id: 'b', sequence: 2, round: 1, task_index: 1 },
          { worker_id: 'a', sequence: 1, round: 1, task_index: 0 },
        ],
      },
    ]);

    expect(result.winner).toBe('new');
    expect(result.structured.resolution).toBe('judge');
    expect(result.status).toBe('partial');
    expect(result.delegations.map((item) => item.worker_id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('groups valid votes and keeps invalid votes visible', () => {
    const result = normalizeAgentTeamOutput({
      process: 'vote',
      votes: [
        {
          worker_id: 'a',
          choice: 'approve',
          confidence: 0.8,
          status: 'valid',
        },
        {
          worker_id: 'b',
          choice: 'approve',
          confidence: 0.6,
          status: 'valid',
        },
        {
          worker_id: 'c',
          choice: '',
          confidence: 0,
          status: 'invalid',
          error: 'malformed vote',
        },
      ],
    });

    expect(result.voteGroups).toEqual([
      expect.objectContaining({
        choice: 'approve',
        count: 2,
        confidence: 1.4,
      }),
    ]);
    expect(result.invalidVotes).toHaveLength(1);
    expect(result.invalidVotes[0].error).toBe('malformed vote');
  });

  it('distinguishes an omitted consensus from an explicit false value', () => {
    const result = normalizeAgentTeamOutput({
      consensus: false,
      tie_break: 'judge selected the lower-risk proposal',
    });

    expect(result.hasConsensusValue).toBe(true);
    expect(result.consensus).toBe(false);
    expect(result.tieBreak).toBe(
      'judge selected the lower-risk proposal',
    );
  });

  it('preserves malformed structured output and the backend error', () => {
    const result = normalizeAgentTeamOutput({
      structured: '{not-json',
      _ERROR: 'consensus process produced no valid votes',
    });

    expect(result.structured).toEqual({});
    expect(result.structuredParseError).toBeTruthy();
    expect(result.error).toBe('consensus process produced no valid votes');
    expect(result.status).toBe('failed');
  });

  it('returns stable empty collections for missing output', () => {
    const result = normalizeAgentTeamOutput(undefined);

    expect(result.status).toBe('notRun');
    expect(result.delegations).toEqual([]);
    expect(result.votes).toEqual([]);
    expect(result.rounds).toEqual([]);
    expect(result.winner).toBe('');
    expect(result.consensus).toBe(false);
    expect(result.hasConsensusValue).toBe(false);
  });

  it('reports an execution failure even when no node output was emitted', () => {
    const result = normalizeAgentTeamOutput(undefined, 'worker timed out');

    expect(result.status).toBe('failed');
    expect(result.delegations).toEqual([]);
  });
});
