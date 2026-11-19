import { DSL } from '@/interfaces/database/agent';
import { extractTeamNodes } from './extract-teams';

const dslWithTeam = {
  components: {
    begin: { obj: { component_name: 'Begin' } },
    'AgentTeam:1': {
      downstream: [],
      obj: {
        component_name: 'AgentTeam',
        params: {
          process: 'debate',
          workers: [
            { id: 'researcher', name: 'Researcher', agent: { params: {} } },
            { id: 'writer', name: 'Writer', agent: { params: {} } },
          ],
          tasks: [
            { worker: 'researcher', task: 'collect', expected_output: 'sources' },
          ],
          judge: 'writer',
          manager: { params: { llm_id: 'qwen' } },
          max_delegations: 12,
          max_depth: 2,
        },
      },
    },
  },
} as unknown as DSL;

describe('extractTeamNodes', () => {
  it('returns one summary per AgentTeam node', () => {
    const teams = extractTeamNodes(dslWithTeam);

    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      componentId: 'AgentTeam:1',
      process: 'debate',
      judge: 'writer',
      managerLlmId: 'qwen',
      maxDelegations: 12,
      maxDepth: 2,
    });
    expect(teams[0].workers.map((worker) => worker.id)).toEqual([
      'researcher',
      'writer',
    ]);
  });

  it('ignores canvases without a team node', () => {
    expect(
      extractTeamNodes({ components: { begin: { obj: { component_name: 'Begin' } } } } as unknown as DSL),
    ).toEqual([]);
    expect(extractTeamNodes(undefined)).toEqual([]);
  });

  it('falls back to hierarchical and empty collections for sparse params', () => {
    const teams = extractTeamNodes({
      components: {
        t: { obj: { component_name: 'AgentTeam', params: {} } },
      },
    } as unknown as DSL);

    expect(teams[0].process).toBe('hierarchical');
    expect(teams[0].workers).toEqual([]);
    expect(teams[0].tasks).toEqual([]);
    expect(teams[0].maxDelegations).toBe(8);
  });
});
