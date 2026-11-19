import {
  clampProgress,
  describeRejection,
  extLabel,
  extOf,
  toneFor,
  totalBytes,
} from './utils';

describe('file-upload-tray utils', () => {
  it('reads the extension case-insensitively and ignores dotfiles', () => {
    expect(extOf('Report.PDF')).toBe('pdf');
    expect(extOf('archive.tar.gz')).toBe('gz');
    expect(extOf('.env')).toBe('');
    expect(extOf('README')).toBe('');
    expect(extOf('trailing.')).toBe('');
  });

  it('maps extensions to a colour tone and caps the badge text', () => {
    expect(toneFor('a.xlsx')).toBe('sheet');
    expect(toneFor('a.docx')).toBe('doc');
    expect(toneFor('a.md')).toBe('text');
    expect(toneFor('a.bin')).toBe('generic');
    expect(extLabel('a.xlsx')).toBe('XLSX');
    expect(extLabel('a.jpeg')).toBe('JPEG');
    expect(extLabel('LICENSE')).toBe('FILE');
  });

  it('clamps progress into 0..100 integers', () => {
    expect(clampProgress(undefined)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(-3)).toBe(0);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(140)).toBe(100);
  });

  it('describes each rejection with the numbers the user needs', () => {
    expect(
      describeRejection(
        { name: 'mood.png', size: 12.6 * 1024 * 1024, code: 'file-too-large' },
        { maxSize: 10 * 1024 * 1024 },
      ),
    ).toEqual({
      key: 'fileManager.rejectedTooLarge',
      values: { name: 'mood.png', size: '13 MB', limit: '10 MB' },
    });

    expect(
      describeRejection({ name: 'a.exe', size: 10, code: 'file-invalid-type' }),
    ).toEqual({
      key: 'fileManager.rejectedType',
      values: { name: 'a.exe' },
    });

    expect(
      describeRejection(
        { name: 'a.pdf', size: 10, code: 'too-many-files' },
        { maxFileCount: 32 },
      ),
    ).toEqual({
      key: 'fileManager.rejectedCount',
      values: { max: 32 },
    });
  });

  it('sums file sizes', () => {
    const files = [
      new File(['abc'], 'a.txt'),
      new File(['defgh'], 'b.txt'),
    ];
    expect(totalBytes(files)).toBe(8);
    expect(totalBytes([])).toBe(0);
  });
});
