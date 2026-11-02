import { IAgentTeamWorker } from '@/interfaces/database/agent';
import {
  normalizeCapabilities,
  resolveWorkerSelector,
} from './validation';

function makeWorker(
  id: string,
  capabilities: IAgentTeamWorker['capabilities'],
): IAgentTeamWorker {
  return {
    id,
    name: id,
    role: '',
    capabilities,
    agent: { params: { llm_id: `${id}-model` } },
  };
}

describe('AgentTeam imported value normalization', () => {
  it('keeps a backend-compatible string capability as one capability', () => {
    expect(normalizeCapabilities(' research ')).toEqual(['research']);
    expect(normalizeCapabilities(['analysis', '', ' '])).toEqual([
      'analysis',
    ]);
  });

  it('resolves a string capability without turning it into characters', () => {
    const worker = makeWorker(
      'researcher',
      'research' as unknown as string[],
    );

    expect(resolveWorkerSelector([worker], 'research')).toEqual({
      worker,
    });
  });
});
