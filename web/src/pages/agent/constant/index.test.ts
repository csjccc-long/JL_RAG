import { Operator } from '@/constants/agent';
import { NodeMap, initialAgentTeamValues } from '.';

describe('AgentTeam canvas registration', () => {
  it('registers AgentTeam as a native canvas node', () => {
    expect(Operator.AgentTeam).toBe('AgentTeam');
    expect(NodeMap[Operator.AgentTeam]).toBe('agentTeamNode');
  });

  it('starts hierarchical with a valid manager prompt shape', () => {
    expect(initialAgentTeamValues.process).toBe('hierarchical');
    expect(initialAgentTeamValues.manager.params.prompts).toHaveLength(1);
    expect(initialAgentTeamValues.workers).toEqual([]);
    expect(initialAgentTeamValues.max_delegations).toBe(8);
  });
});
