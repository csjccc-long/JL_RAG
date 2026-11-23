import { render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ResultPanel from './result-panel';

const renderPanel = (props: any) => render(<ResultPanel answer="" error="" running={false} {...props} />);

describe('ResultPanel', () => {
  it('把 parallel 的 JSON content 拆成按 worker 分段的结论', () => {
    const content = JSON.stringify({
      process: 'parallel',
      status: 'ok',
      results: [
        { task_index: 0, worker_id: 'alpha', status: 'ok', result: '风险一' },
        { task_index: 1, worker_id: 'beta', status: 'ok', result: '风险二' },
      ],
    });
    renderPanel({ snapshot: { outputs: { content } } });

    expect(screen.getByText(/alpha：风险一/)).toBeInTheDocument();
    expect(screen.getByText(/beta：风险二/)).toBeInTheDocument();
    expect(screen.queryByText(/"process":"parallel"/)).toBeNull();
  });

  it('优先展示判官 summary', () => {
    renderPanel({
      snapshot: {
        outputs: {
          structured: { summary: '团队最终结论' },
          content: '{"process":"vote","status":"ok"}',
        },
      },
    });
    expect(screen.getByText('团队最终结论')).toBeInTheDocument();
  });

  it('没有结构化结果时回落到普通回答', () => {
    renderPanel({ answer: '这是一段普通回答' });
    expect(screen.getByText('这是一段普通回答')).toBeInTheDocument();
  });
  it('把主管覆盖不足的英文告警翻成界面语言', () => {
    renderPanel({
      snapshot: {
        outputs: {
          structured: {
            status: 'partial',
            warning: 'The manager dispatched 1 of 3 workers; not delegated: Analyst, Auditor.',
          },
        },
      },
    });
    expect(
      screen.getByText('flow.agentTeam.warning.partialCoverage'),
    ).toBeInTheDocument();
  });

  it('空态里铺开分发盘，结论出来后收起', () => {
    const { unmount } = renderPanel({});
    expect(screen.getByTestId('result-dial')).toBeInTheDocument();

    unmount();
    renderPanel({ snapshot: { outputs: { structured: { summary: '结论' } } } });
    expect(screen.queryByTestId('result-dial')).toBeNull();
  });

  it('未知告警原样显示', () => {
    renderPanel({
      snapshot: { outputs: { structured: { warning: 'Something odd happened.' } } },
    });
    expect(screen.getByText('Something odd happened.')).toBeInTheDocument();
  });
});