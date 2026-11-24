import { fireEvent, render } from '@testing-library/react';

import ResultDial, { AgentAvatar, Expressions, ShapeChoices, avatarOf, morphOutline } from './result-dial';

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

  // 塑形过渡要在同一条轮廓上做：影、脸、裁剪三张 path 必须共用一份 d，
  // 否则换形状时影子会比脸慢半拍，边缘还会露出没被裁掉的眼睛。
  it('影、脸、裁剪始终共用同一条轮廓', () => {
    const { container } = render(<ResultDial />);
    const center = centerFace(container) as HTMLElement;
    const paths = Array.from(center.querySelectorAll('path'));
    expect(paths).toHaveLength(3);
    expect(paths[1].getAttribute('d')).toBe(paths[0].getAttribute('d'));
    expect(paths[2].getAttribute('d')).toBe(paths[0].getAttribute('d'));

    fireEvent.click(container.querySelector('.team-dial-chip[data-shape="heart"]') as Element);
    const after = Array.from(center.querySelectorAll('path'));
    expect(after[1].getAttribute('d')).toBe(after[0].getAttribute('d'));
    expect(after[2].getAttribute('d')).toBe(after[0].getAttribute('d'));
  });

  // 换形状是从"此刻画着的那圈点"插到新轮廓：两端必须精确落到起止形状上，
  // 中途只能是中间态（否则要么跳变、要么永远到不了）。
  it('塑形过渡两端精确、中途是中间态', () => {
    const from = [
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: -10, y: 0 },
      { x: 0, y: -10 },
    ];
    const to = [
      { x: 20, y: 0 },
      { x: 0, y: 20 },
      { x: -20, y: 0 },
      { x: 0, y: -20 },
    ];
    const radiusOf = (point: { x: number; y: number }) => Math.hypot(point.x, point.y);

    expect(morphOutline(from, to, 0, 10).map(radiusOf)).toEqual(from.map(radiusOf));
    expect(morphOutline(from, to, 1, 10).map(radiusOf)).toEqual(to.map(radiusOf));

    const mid = radiusOf(morphOutline(from, to, 0.5, 10)[0]);
    expect(mid).toBeGreaterThan(14.4);
    expect(mid).toBeLessThan(15.6);
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
