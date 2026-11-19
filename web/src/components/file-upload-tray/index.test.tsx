import { act, fireEvent, render, screen } from '@testing-library/react';

const translations: Record<string, string> = {
  'common.removeFile': '移除文件',
  'fileManager.uploaded': '已上传',
  'fileManager.pendingUpload': '待上传',
  'fileManager.uploading': '正在上传',
  'fileManager.uploadFolderTitle': '上传文件夹',
  'fileManager.rejectedTooLarge': '文件太大',
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown) =>
      typeof second === 'string' ? second : (translations[key] ?? key),
  }),
}));

import { UploadDropArea } from './index';

const makeFile = (name: string, size = 2048) =>
  new File([new Uint8Array(size)], name, { type: 'application/pdf' });

describe('UploadDropArea', () => {
  it('lists staged files with their size and removes the clicked one', () => {
    const onRemove = jest.fn();
    render(
      <UploadDropArea
        files={[makeFile('账期说明.pdf'), makeFile('对账明细.xlsx')]}
        maxFileCount={32}
        onRemove={onRemove}
      />,
    );

    // the first file is also held in the box, so the name appears twice
    expect(screen.getAllByText('账期说明.pdf').length).toBeGreaterThan(0);
    expect(screen.getAllByText('对账明细.xlsx').length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole('button', { name: /移除文件: 对账明细\.xlsx/ }),
    );
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('renders the rejection reason instead of a toast', () => {
    render(
      <UploadDropArea
        files={[]}
        maxFileCount={32}
        onRemove={jest.fn()}
        rejection={{
          id: 7,
          key: 'fileManager.rejectedTooLarge',
          values: { name: 'mood.png', size: '12 MB', limit: '10 MB' },
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('文件太大');
  });

  it('holds the picked file in the box before anything is sent', () => {
    const { container } = render(
      <UploadDropArea
        files={[makeFile('合同.pdf')]}
        maxFileCount={32}
        onRemove={jest.fn()}
      />,
    );

    // picked, not started: the row is already in the box, the bar is empty
    expect(container.querySelector('.upl-now')).not.toBeNull();
    expect(screen.getByText(/待上传/)).toBeInTheDocument();
    expect(container.querySelector('.upl-box')?.getAttribute('data-busy')).toBe(
      'true',
    );
    expect(
      (container.querySelector('.upl-track > i') as HTMLElement).style.width,
    ).toBe('0%');
    expect(container.querySelector('.upl-roll')).toBeNull();
    expect(container.querySelector('.upl-tick')).toBeNull();
  });

  it('shows the live upload row with real progress', () => {
    render(
      <UploadDropArea
        files={[makeFile('合同.pdf')]}
        maxFileCount={32}
        progresses={{ '合同.pdf': 42 }}
        onRemove={jest.fn()}
      />,
    );

    expect(screen.getAllByText('合同.pdf').length).toBeGreaterThan(0);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('opens the folder picker when the box is clicked in folder mode', () => {
    const onActivate = jest.fn();
    const { container } = render(
      <UploadDropArea
        files={[]}
        maxFileCount={32}
        isFolderMode
        onActivate={onActivate}
        onRemove={jest.fn()}
      />,
    );

    fireEvent.click(container.querySelector('.upl-box') as HTMLElement);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('holds the finished file in the box a beat, then hands it to the tray', () => {
    jest.useFakeTimers();
    const { container } = render(
      <UploadDropArea
        files={[makeFile('合同.pdf')]}
        maxFileCount={32}
        progresses={{ '合同.pdf': 100 }}
        completed={{ '合同.pdf': true }}
        onRemove={jest.fn()}
      />,
    );

    // the tick lands in the box first
    expect(container.querySelector('.upl-tick')).not.toBeNull();
    expect(screen.getAllByText(/已上传/).length).toBeGreaterThan(0);

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // then the box lets go and the card keeps the mark
    expect(container.querySelector('.upl-tick')).toBeNull();
    expect(container.querySelector('.upl-badge')).not.toBeNull();
    jest.useRealTimers();
  });

  it('stops being polite when the same file is refused again', () => {
    const rejection = {
      id: 1,
      key: 'fileManager.rejectedTooLarge',
      values: { name: 'mood.png', size: '12 MB', limit: '10 MB' },
    };
    const { rerender } = render(
      <UploadDropArea
        files={[]}
        maxFileCount={32}
        onRemove={jest.fn()}
        rejection={rejection}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('文件太大');

    rerender(
      <UploadDropArea
        files={[]}
        maxFileCount={32}
        onRemove={jest.fn()}
        rejection={{ ...rejection, id: 2 }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      '还是同一个文件，大小没变',
    );
  });

  it('rolls each digit by its row height, not by an em', () => {
    const { container } = render(
      <UploadDropArea
        files={[makeFile('合同.pdf')]}
        maxFileCount={32}
        progresses={{ '合同.pdf': 53 }}
        onRemove={jest.fn()}
      />,
    );

    const strips = [...container.querySelectorAll('.upl-roll-strip')] as HTMLElement[];
    // 5 sits 5 rows up, 3 sits 3 rows up, one row being 16px
    expect(strips.map((s) => s.style.transform)).toEqual([
      'translateY(-80px)',
      'translateY(-48px)',
    ]);
  });

  it('marks the live row as done at 100%', () => {
    render(
      <UploadDropArea
        files={[makeFile('合同.pdf')]}
        maxFileCount={32}
        progresses={{ '合同.pdf': 100 }}
        onRemove={jest.fn()}
      />,
    );

    // The odometer reads 100% visually; the live-region copy is dropped at 100
    // so a screen reader hears "已上传" once, not "已上传 100%".
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getByText(/已上传/)).toBeInTheDocument();
    expect(document.querySelector('.upl-tick')).not.toBeNull();
  });
});
