import { buildTeamDsl, planTeam, teamNodeName } from './build-team-dsl';
import { seedExpectedText, seedTaskText } from './apply-process';
import { IAgentTeamWorker } from '@/interfaces/database/agent';

const worker = (id: string): IAgentTeamWorker => ({
  id,
  name: id,
  role: '',
  agent_id: id,
  agent: { params: { llm_id: 'qwen2.5:3b' } },
});

const seed = {
  task: seedTaskText,
  expected: seedExpectedText(),
  manager: '你是主管',
};
const crew = ['alpha', 'beta', 'gamma'].map(worker);

describe('teamNodeName', () => {
  it('keeps a name usable inside a {AgentTeam:x@content} expression', () => {
    expect(teamNodeName('多智能体·新团队')).toBe('多智能体·新团队');
    expect(teamNodeName('评审: 一期')).toBe('评审-一期');
    expect(teamNodeName('  a  b  ')).toBe('a-b');
    expect(teamNodeName('   ')).toBe('Team');
  });
});

describe('planTeam', () => {
  it('gives every member one task under parallel', () => {
    const plan = planTeam('parallel', crew, seed);
    expect(plan.tasks.map((task) => task.worker)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
    expect(plan.judge).toBe('');
    expect(plan.manager).toEqual({});
    expect(plan.maxDelegations).toBeGreaterThanOrEqual(3);
  });

  it('drops the tasks and stands up a manager under hierarchical', () => {
    const plan = planTeam('hierarchical', crew, seed);
    expect(plan.tasks).toEqual([]);
    expect(plan.judge).toBe('');
    expect(plan.manager).toEqual({
      params: { llm_id: 'qwen2.5:3b', sys_prompt: '你是主管' },
    });
  });

  it('keeps the last member back as the judge under vote', () => {
    const plan = planTeam('vote', crew, seed);
    expect(plan.tasks.map((task) => task.worker)).toEqual(['alpha', 'beta']);
    expect(plan.judge).toBe('gamma');
    expect(plan.maxDelegations).toBeGreaterThanOrEqual(3);
  });

  it('budgets a debate by rounds and still leaves the judge out of it', () => {
    const plan = planTeam('debate', crew, seed, 2);
    expect(plan.tasks).toHaveLength(2);
    expect(plan.judge).toBe('gamma');
    expect(plan.maxDelegations).toBeGreaterThanOrEqual(2 * 2 + 1);
  });

  it('never asks a one-member team for a judge', () => {
    const plan = planTeam('vote', [worker('solo')], seed);
    expect(plan.judge).toBe('');
    expect(plan.tasks.map((task) => task.worker)).toEqual(['solo']);
  });
});

describe('buildTeamDsl', () => {
  const dsl = buildTeamDsl({
    title: '多智能体·新团队',
    nodeName: '多智能体·新团队',
    process: 'vote',
    workers: crew,
    seed,
    prologue: '你好',
  });

  it('wires begin → the team → the message that reads it', () => {
    expect(dsl.path).toEqual(['begin', 'AgentTeam:多智能体·新团队', 'Message:Out']);
    expect(dsl.graph?.edges?.map((edge) => [edge.source, edge.target])).toEqual([
      ['begin', 'AgentTeam:多智能体·新团队'],
      ['AgentTeam:多智能体·新团队', 'Message:Out'],
    ]);
  });

  it('writes the same parameters to the component and the canvas node', () => {
    const key = 'AgentTeam:多智能体·新团队';
    const params = dsl.components?.[key].obj.params;
    const form = dsl.graph?.nodes?.find((node) => node.id === key)?.data.form;
    expect(params.process).toBe('vote');
    expect(form.process).toBe('vote');
    expect(params.judge).toBe('gamma');
    const tasks = params.tasks as Array<{ expected_output: string }>;
    expect(tasks).toHaveLength(2);
    expect(tasks[0].expected_output).toBeTruthy();
    expect(form.workers).toHaveLength(3);
  });

  it('has the outgoing message read the team, not the begin node', () => {
    expect(dsl.components?.['Message:Out'].obj.params.content).toEqual([
      '{AgentTeam:多智能体·新团队@content}',
    ]);
  });
});
