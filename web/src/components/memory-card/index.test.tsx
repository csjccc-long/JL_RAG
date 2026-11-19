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

  it('removes without letting the press reach the dot field', () => {
    const onRemove = jest.fn();
    render(<MemoryCard {...baseProps} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
