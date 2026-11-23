import { fireEvent, render } from '@testing-library/react';

import ResultDial, { Expressions, ShapeChoices } from './result-dial';

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
