import { fireEvent, render } from '@testing-library/react';

import ResultDial, { AgentAvatar, Expressions, ShapeChoices, avatarOf } from './result-dial';

const ringFaces = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.team-dial-agent .team-dial-face'));

const centerFace = (container: HTMLElement) => container.querySelector('.team-dial-face[data-center="true"]');

describe('ResultDial', () => {
  // 参考图：外面一圈是表情，而且都是圆的。
  it('环上一圈都是表情', () => {
    const { container } = render(<ResultDial />);
    const faces = ringFaces(container);
    expect(faces).toHaveLength(Expressions.length);
    faces.forEach((face) => expect(face.getAttribute('data-shape')).toBe('circle'));
  });

  // 参考图：形状是下面单独一排，不是环上的位置。
  it('形状在底部单独一排', () => {
    const { container } = render(<ResultDial />);
    expect(container.querySelectorAll('.team-dial-chip')).toHaveLength(ShapeChoices.length);
  });

  it('每张脸都装了一对眼睛', () => {
    const { container } = render(<ResultDial />);
    expect(container.querySelectorAll('.team-dial-eye')).toHaveLength((Expressions.length + 1) * 2);
  });

  // 中间只负责展示：换形状，中心跟着换。
  it('选一个形状，中间就换成它', () => {
    const { container } = render(<ResultDial />);
    expect(centerFace(container)?.getAttribute('data-shape')).toBe('cloud');

    const star = container.querySelector('.team-dial-chip[data-shape="star"]');
    fireEvent.click(star as Element);
    expect(centerFace(container)?.getAttribute('data-shape')).toBe('star');

    const picked = container.querySelectorAll('.team-dial-chip[data-picked="true"]');
    expect(picked).toHaveLength(1);
    expect(picked[0].getAttribute('data-shape')).toBe('star');
  });

  // 换表情同理：点环上哪张脸，中心就用哪双眼睛。
  it('选一个表情，中间就换成它', () => {
    const { container } = render(<ResultDial />);
    const faces = ringFaces(container);
    fireEvent.click(faces[2]);
    expect(centerFace(container)?.getAttribute('data-eyes')).toBe(String(Expressions[2]));

    const picked = container.querySelectorAll('.team-dial-agent .team-dial-face[data-picked="true"]');
    expect(picked).toHaveLength(1);
  });
});

describe('AgentAvatar', () => {
  // 同一个 agent 在哪儿出现都是同一张脸。
  it('同一个 id 永远是同一张脸', () => {
    const { container } = render(
      <>
        <AgentAvatar seed="agent-7f3" />
        <AgentAvatar seed="agent-7f3" />
      </>,
    );
    const faces = Array.from(container.querySelectorAll('svg[data-avatar]'));
    expect(faces).toHaveLength(2);
    expect(faces[0].getAttribute('data-avatar')).toBe(faces[1].getAttribute('data-avatar'));
  });

  it('形状和表情都从允许的集合里取', () => {
    const ids = ['a', 'b', 'c', 'agent-x', '工作量估算师', '漏洞猎手'];
    const shapes = new Set(ids.map((id) => avatarOf(id).shape));
    ids.forEach((id) => {
      const { shape, variant } = avatarOf(id);
      expect(ShapeChoices).toContain(shape);
      expect(variant).toBeGreaterThanOrEqual(0);
      expect(variant).toBeLessThan(Expressions.length);
    });
    /* 一组真实 id 不该全撞成同一个形状，否则"按 id 分配"就白做了 */
    expect(shapes.size).toBeGreaterThan(1);
  });
});
