import { fireEvent, render } from '@testing-library/react';

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

  // 参考图里每种外形都有：圆形、圆角方、蛋形、花、星、心。
  it('每个头像都带自己的外形', () => {
    const { container } = render(<ResultDial />);
    const shapes = new Set(
      Array.from(container.querySelectorAll('.team-dial-face')).map((face) => face.getAttribute('data-shape')),
    );
    ['circle', 'squircle', 'egg', 'flower', 'star', 'heart'].forEach((shape) => {
      expect(shapes.has(shape)).toBe(true);
    });
  });

  // 每张脸都是一对球面上的眼睛，圆心那张召集者也要有。
  it('每张脸都装了一对眼睛', () => {
    const { container } = render(<ResultDial />);
    expect(container.querySelectorAll('.team-dial-eye')).toHaveLength((AgentPresets.length + 1) * 2);
  });

  // 「对形状的选择」：点哪个，选中环就移到哪个，而不是同时亮好几个。
  it('点选一个头像后只有它被选中', () => {
    const { container } = render(<ResultDial />);
    const star = container.querySelector('.team-dial-face[data-shape="star"]');
    expect(star).not.toBeNull();
    fireEvent.click(star as Element);
    const picked = container.querySelectorAll('.team-dial-face[data-picked="true"]');
    expect(picked).toHaveLength(1);
    expect(picked[0].getAttribute('data-shape')).toBe('star');
  });
});
