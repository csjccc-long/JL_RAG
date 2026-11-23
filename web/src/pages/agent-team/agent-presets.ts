/**
 * 分发盘上的预置 agent。
 *
 * 现在只有形状和一张脸：等到真接上分发逻辑，这里会补上名称、能力、模型，
 * 盘上的头像也就是从这份名单里点选的入口。shape 是外形，face 是眼神（0..9）。
 */
export type AgentShape = 'circle' | 'squircle' | 'egg' | 'flower' | 'star' | 'heart';

export interface AgentPreset {
  id: string;
  shape: AgentShape;
  face: number;
}

export const AgentPresets: AgentPreset[] = [
  { id: 'scout', shape: 'circle', face: 0 },
  { id: 'reader', shape: 'squircle', face: 1 },
  { id: 'analyst', shape: 'egg', face: 4 },
  { id: 'drafter', shape: 'flower', face: 2 },
  { id: 'reviewer', shape: 'star', face: 6 },
  { id: 'verifier', shape: 'heart', face: 3 },
  { id: 'searcher', shape: 'circle', face: 5 },
  { id: 'summarizer', shape: 'flower', face: 7 },
  { id: 'planner', shape: 'egg', face: 8 },
  { id: 'auditor', shape: 'star', face: 9 },
  { id: 'negotiator', shape: 'squircle', face: 2 },
  { id: 'scribe', shape: 'heart', face: 1 },
];

export const AgentOrbit = 150;
