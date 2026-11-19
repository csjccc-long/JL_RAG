// 任务是否需要"多智能体协作"的启发式判定。
//
// 这里不调用模型：用户从聊天页发消息时，命中明显需要分工/对比/调研的任务，
// 就直接把他带到协作台（任务预填），避免普通一问一答被误劫持。判定偏保守，
// 宁可漏判也不要把闲聊重定向走。

const EXPLICIT_MARKERS = [
  '@团队',
  '多智能体',
  '智能体团队',
  'agent team',
  'multi-agent',
  'multi agent',
];

const COLLABORATION_HINTS = [
  '分别',
  '逐个',
  '同时',
  '对比',
  '比较',
  '调研',
  '评估',
  '评审',
  '汇总',
  '分工',
  '多个角度',
  '各个角度',
  '分工协作',
];

const countQuestionMarks = (text: string) =>
  (text.match(/[?？]/g) ?? []).length;

const hasListStructure = (text: string) =>
  /(^|\n)\s*(\d+[.、)]|[-*]\s)/m.test(text);

export const shouldRouteToAgentTeam = (query: string): boolean => {
  const text = (query ?? '').trim();
  if (text.length < 8) return false;

  const lower = text.toLowerCase();
  if (EXPLICIT_MARKERS.some((marker) => lower.includes(marker))) {
    return true;
  }

  // 每个协作线索记 2 分：一个线索 + 一个结构信号（多问号/列表/长文本）
  // 就够 3 分触发；单个线索（如"对比一下这两个数字"）仍留在普通问答里。
  let score = 0;
  COLLABORATION_HINTS.forEach((hint) => {
    if (text.includes(hint)) score += 2;
  });
  if (countQuestionMarks(text) >= 2) score += 1;
  if (hasListStructure(text)) score += 1;
  if (text.length > 80) score += 1;

  return score >= 3;
};

export const buildAgentTeamUrl = (query: string, agentId?: string) => {
  const params = new URLSearchParams({ task: query, auto: '1' });
  if (agentId) params.set('agentId', agentId);
  return `/agent-team?${params.toString()}`;
};