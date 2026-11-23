import { render } from '@testing-library/react';

import { AgentPresets } from './agent-presets';
import ResultDial from './result-dial';

describe('ResultDial', () => {
  // 盘上的头像就是预置名单本身：将来点选 agent 时，位置和数量都得对得上。
  it('每个预置 agent 都在盘上占一个位置', () => {
    const { container } = render(<ResultDial />);
    const faces = container.querySelectorAll('.team-dial-agent');
    expect(faces).toHaveLength(AgentPresets.length);
  });

  it('名单不重复', () => {
    const ids = AgentPresets.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
