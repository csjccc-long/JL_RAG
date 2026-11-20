import { fireEvent, render, screen } from '@testing-library/react';

import MemoryCard from './index';

const baseProps = {
  heading: '记忆01',
  title: '向量索引的维度固定为 1024',
  meta: '19/11/2026 18:31:53',
  badge: 'WORLD',
  removeLabel: '删除',
};

describe('MemoryCard', () => {
  it('fills the card with the dot field and keeps the words on top of it', () => {
    const { container } = render(<MemoryCard {...baseProps} />);

    expect(container.querySelector('.pfield canvas')).toBeInTheDocument();
    expect(screen.getByText(baseProps.heading)).toBeInTheDocument();
    expect(screen.getByText(baseProps.title)).toBeInTheDocument();
    expect(screen.getByText(baseProps.meta)).toBeInTheDocument();
    expect(screen.getByText('WORLD')).toBeInTheDocument();
  });

  it('keeps only the wires in the DOM, because the nodes are the field\'s own dots', () => {
    const { container } = render(<MemoryCard {...baseProps} />);

    // 4 inputs x 5 hidden + 5 hidden x 2 outputs, each drawn one after another
    expect(container.querySelectorAll('.pfield-wires path')).toHaveLength(30);
    // no second dot layer and no axis captions: the canvas reuses its own dots
    expect(container.querySelectorAll('.pfield-node')).toHaveLength(0);
    expect(container.querySelector('.pfield-node-label')).toBeNull();
  });

  it('removes without letting the press reach the dot field', () => {
    const onRemove = jest.fn();
    render(<MemoryCard {...baseProps} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
