import { act, fireEvent, render, screen } from '@testing-library/react';

import DispatchSeek from './dispatch-seek';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
});

const setup = (props: Record<string, unknown> = {}) => {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  render(
    <DispatchSeek
      value=""
      placeholder="描述要交给团队完成的任务…"
      label="分发任务"
      onChange={onChange}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onChange, onSubmit };
};

const open = async () => {
  jest.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: '分发任务' }));
  await act(async () => {
    jest.advanceTimersByTime(120);
  });
  jest.useRealTimers();
};

describe('DispatchSeek', () => {
  // 收起时它就是一个圆：输入框还在盒子里，但不该抢到焦点。
  it('收起时只有一个圆按钮，输入框不可聚焦', () => {
    setup();
    expect(
      screen.getByRole('button', { name: '分发任务' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('tabindex', '-1');
  });

  it('点开后输入框接管焦点', async () => {
    setup();
    await open();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('输入回报给上层', async () => {
    const { onChange } = setup();
    await open();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '审一遍付款条款' },
    });
    expect(onChange).toHaveBeenCalledWith('审一遍付款条款');
  });

  it('有内容时回车才提交', async () => {
    const { onSubmit } = setup({ value: '审一遍付款条款' });
    await open();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('空内容回车不提交', async () => {
    const { onSubmit } = setup();
    await open();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Esc 收起但不清空已写的任务', async () => {
    const { onChange, onSubmit } = setup({ value: '审一遍付款条款' });
    await open();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});