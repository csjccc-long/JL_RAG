/**
 * 分发盘上的预置 agent。
 *
 * 现在只有 id 和一张脸：等到真接上分发逻辑，这里会补上名称、能力、模型，
 * 盘上的头像也就是从这份名单里点选的入口。face 只是画眼睛的方式（0..5）。
 */
export interface AgentPreset {
  id: string;
  face: number;
}

export const AgentPresets: AgentPreset[] = [
  { id: 'scout', face: 0 },
  { id: 'reader', face: 1 },
  { id: 'analyst', face: 2 },
  { id: 'drafter', face: 3 },
  { id: 'reviewer', face: 4 },
  { id: 'verifier', face: 5 },
  { id: 'searcher', face: 1 },
  { id: 'summarizer', face: 2 },
  { id: 'planner', face: 0 },
  { id: 'auditor', face: 4 },
  { id: 'negotiator', face: 3 },
  { id: 'scribe', face: 5 },
];

export const AgentOrbit = 150;
