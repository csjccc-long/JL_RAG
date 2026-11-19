type Handler = ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;

class FakeXhr {
  static last: FakeXhr;

  upload: { onprogress: Handler } = { onprogress: null };

  status = 200;

  responseText = '';

  headers: Record<string, string> = {};

  body: unknown;

  onload: (() => void) | null = null;

  onerror: (() => void) | null = null;

  ontimeout: (() => void) | null = null;

  onabort: (() => void) | null = null;

  open() {}

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: unknown) {
    this.body = body;
    FakeXhr.last = this;
  }

  abort() {
    this.onabort?.();
  }
}

const original = global.XMLHttpRequest;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('Authorization', 'Bearer token-1');
  (global as any).XMLHttpRequest = FakeXhr;
});

afterEach(() => {
  (global as any).XMLHttpRequest = original;
});

import { postFormWithProgress } from './upload-with-progress';

describe('postFormWithProgress', () => {
  it('reports the body leaving the browser, and 100 only once the server answers', async () => {
    const seen: number[] = [];
    const form = new FormData();
    form.append('file', new Blob(['abc']), 'a.txt');

    const promise = postFormWithProgress({
      url: '/api/v1/files',
      formData: form,
      onProgress: (percent) => seen.push(percent),
    });

    const xhr = FakeXhr.last;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 4, total: 4 });
    expect(seen).toEqual([25, 99]);

    xhr.status = 200;
    xhr.responseText = JSON.stringify({ code: 0, data: ['ok'] });
    xhr.onload?.();

    await expect(promise).resolves.toEqual({ code: 0, data: ['ok'] });
    expect(seen).toEqual([25, 99, 100]);
  });

  it('sends the authorization header the rest of the app uses', async () => {
    const form = new FormData();
    const promise = postFormWithProgress({ url: '/api/v1/files', formData: form });
    FakeXhr.last.status = 200;
    FakeXhr.last.responseText = '{"code":0}';
    FakeXhr.last.onload?.();
    await promise;
    expect(FakeXhr.last.headers.Authorization).toBe('Bearer token-1');
  });

  it('rejects with the server message when the upload fails', async () => {
    const promise = postFormWithProgress({
      url: '/api/v1/files',
      formData: new FormData(),
    });
    FakeXhr.last.status = 500;
    FakeXhr.last.responseText = JSON.stringify({ code: 500, message: 'no room' });
    FakeXhr.last.onload?.();
    await expect(promise).rejects.toThrow('no room');
  });
});
