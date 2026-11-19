import { formatBytes } from '@/lib/utils';

/**
 * Visual language for the upload tray: every file gets a page tile whose colour
 * comes from its extension, so a mixed batch (pdf + xlsx + png) is readable at a
 * glance instead of "four identical rows".
 */
const TONES: Array<{ tone: UploadTone; exts: string[] }> = [
  { tone: 'doc', exts: ['doc', 'docx', 'rtf', 'odt', 'pages'] },
  { tone: 'pdf', exts: ['pdf'] },
  { tone: 'sheet', exts: ['xls', 'xlsx', 'csv', 'tsv', 'ods', 'numbers'] },
  { tone: 'slide', exts: ['ppt', 'pptx', 'key', 'odp'] },
  { tone: 'text', exts: ['txt', 'md', 'markdown', 'log', 'rst'] },
  {
    tone: 'image',
    exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'avif'],
  },
  { tone: 'video', exts: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'] },
  { tone: 'audio', exts: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'] },
  {
    tone: 'code',
    exts: [
      'js',
      'ts',
      'tsx',
      'jsx',
      'py',
      'java',
      'go',
      'rs',
      'sql',
      'json',
      'yaml',
      'yml',
      'xml',
      'html',
      'css',
      'sh',
      'toml',
      'ini',
    ],
  },
  { tone: 'archive', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2'] },
];

export type UploadTone =
  | 'doc'
  | 'pdf'
  | 'sheet'
  | 'slide'
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'archive'
  | 'generic';

/** Extension without the dot, lowercased. A file called "a.tar.gz" reports "gz". */
export const extOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
};

export const toneFor = (fileName: string): UploadTone => {
  const ext = extOf(fileName);
  if (!ext) return 'generic';
  const hit = TONES.find((entry) => entry.exts.includes(ext));
  return hit?.tone ?? 'generic';
};

/** The badge never shows a raw 9-letter extension; it stays a readable chip. */
export const extLabel = (fileName: string): string => {
  const ext = extOf(fileName);
  if (!ext) return 'FILE';
  return ext.slice(0, 4).toUpperCase();
};

export const clampProgress = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
};

export interface RejectionDescriptor {
  key: string;
  values: Record<string, string | number>;
}

export interface RejectionInput {
  name: string;
  size: number;
  code: 'file-too-large' | 'file-invalid-type' | 'too-many-files' | 'count';
}

export interface RejectionLimits {
  maxSize?: number;
  maxFileCount?: number;
}

/**
 * Turns a dropzone rejection into copy the user can act on: which file, how big
 * it was, what the limit is. Deliberately blunt but not scolding.
 */
export const describeRejection = (
  input: RejectionInput,
  limits: RejectionLimits = {},
): RejectionDescriptor => {
  switch (input.code) {
    case 'file-too-large':
      return {
        key: 'fileManager.rejectedTooLarge',
        values: {
          name: input.name,
          size: formatBytes(input.size),
          limit:
            typeof limits.maxSize === 'number'
              ? formatBytes(limits.maxSize)
              : '—',
        },
      };
    case 'file-invalid-type':
      return {
        key: 'fileManager.rejectedType',
        values: { name: input.name },
      };
    case 'too-many-files':
    case 'count':
      return {
        key: 'fileManager.rejectedCount',
        values: { max: limits.maxFileCount ?? 1 },
      };
  }
};

export const totalBytes = (files: File[]): number =>
  files.reduce((sum, file) => sum + (file.size || 0), 0);
