import { render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ResultDrawer from './result-drawer';

const renderDrawer = (props: any) =>
  render(<ResultDrawer answer="" error="" running={false} {...props} />);

describe('ResultDrawer', () => {
  // 抽屉平时只占一条标题栏：盘面要留给右上角那张分发盘。
  it('空态默认收起', () => {
    renderDrawer({});
    expect(
      screen.getByRole('button', { name: /flow\.agentTeam\.page\.result/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('协作跑完自动铺开', () => {
    renderDrawer({
      snapshot: { outputs: { structured: { summary: '团队最终结论' } } },
    });
    expect(
      screen.getByRole('button', { name: /flow\.agentTeam\.page\.result/ }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('团队最终结论')).toBeInTheDocument();
  });

  it('运行中不铺开，只挂运行标记', () => {
    renderDrawer({ running: true });
    expect(
      screen.getByRole('button', { name: /flow\.agentTeam\.page\.result/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  });
});
