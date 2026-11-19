import {
  buildAgentTeamUrl,
  shouldRouteToAgentTeam,
} from './collaboration-intent';

describe('shouldRouteToAgentTeam', () => {
  it('routes explicit multi-agent requests', () => {
    expect(shouldRouteToAgentTeam('@团队 帮我整理这份季度财报')).toBe(true);
    expect(shouldRouteToAgentTeam('请用多智能体方式分析客户流失')).toBe(true);
  });

  it('routes multi-part research tasks', () => {
    expect(
      shouldRouteToAgentTeam(
        '分别从财务、法务、供应链三个角度调研这家供应商，并对比它们的风险，最后汇总建议',
      ),
    ).toBe(true);
  });

  it('routes a task that pairs a collaboration hint with a structure signal', () => {
    expect(
      shouldRouteToAgentTeam('分别调研这三家供应商，并汇总它们的交付风险'),
    ).toBe(true);
  });

  it('keeps ordinary single questions in the chat', () => {
    expect(shouldRouteToAgentTeam('今天天气怎么样？')).toBe(false);
    expect(shouldRouteToAgentTeam('这张发票的税率是多少？')).toBe(false);
    expect(shouldRouteToAgentTeam('hi')).toBe(false);
  });

  it('does not hijack a short comparison phrase alone', () => {
    expect(shouldRouteToAgentTeam('对比一下这两个数字')).toBe(false);
  });
});

describe('buildAgentTeamUrl', () => {
  it('encodes the task and auto flag', () => {
    const url = buildAgentTeamUrl('调研 供应商 风险');

    expect(url.startsWith('/agent-team?')).toBe(true);
    expect(url).toContain('auto=1');
    // URLSearchParams 把空格编码成 +，解码后按 + 形式断言。
    expect(decodeURIComponent(url)).toContain('task=调研+供应商+风险');
  });

  it('pins the requested agent when given', () => {
    expect(buildAgentTeamUrl('task', 'agent-1')).toContain('agentId=agent-1');
  });
});
