import { IFile } from '@/interfaces/database/file-manager';
import { cn } from '@/lib/utils';
import fileManagerService from '@/services/file-manager-service';
import { FileText } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

type FolderTreeNode = {
  id: string;
  name: string;
  isFolder: boolean;
  children: FolderTreeNode[];
};

type FolderTreeMenuProps = {
  currentFolderId?: string;
  onSelectFolder?: (folderId: string) => void;
  className?: string;
};

const MAX_DEPTH = 3;
const PAGE_SIZE = 100;
// A hover peek must never turn into a crawl: stop after this many list calls.
const MAX_REQUESTS = 40;

type WalkState = { requests: number };

const sortNodes = (nodes: FolderTreeNode[]) =>
  nodes.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;

    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

const fetchFolderTree = async (
  parentId: string,
  depth: number,
  state: WalkState,
): Promise<FolderTreeNode[]> => {
  if (depth > MAX_DEPTH || state.requests >= MAX_REQUESTS) {
    return [];
  }
  state.requests += 1;

  const { data } = await fileManagerService.listFile({
    parent_id: parentId,
    page: 1,
    page_size: PAGE_SIZE,
  });
  const files: IFile[] = data?.data?.files ?? [];
  const nodes: FolderTreeNode[] = [];

  for (const file of files) {
    const isFolder = file.type === 'folder';
    const children =
      isFolder && depth < MAX_DEPTH
        ? await fetchFolderTree(file.id, depth + 1, state)
        : [];

    nodes.push({
      id: file.id,
      name: file.name,
      isFolder,
      children,
    });
  }

  return sortNodes(nodes);
};

const countNodes = (nodes: FolderTreeNode[]): number =>
  nodes.reduce(
    (total, node) => total + 1 + countNodes(node.children),
    0,
  );

// The folder glyph is the one requested from Uiverse.io (by themrsami); its two
// planes follow the warning token so the yellow stays inside the design system.
const FolderGlyph = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 18 14"
    fill="none"
    aria-hidden="true"
    className={cn('shrink-0', className)}
  >
    <path
      className="fill-state-warning brightness-90"
      d="M16.2 1.75H8.1L6.3 0H1.8C0.81 0 0 0.7875 0 1.75V12.25C0 13.2125 0.81 14 1.8 14H15.165L18 9.1875V3.5C18 2.5375 17.19 1.75 16.2 1.75Z"
    />
    <path
      className="fill-state-warning"
      d="M16.2 2H1.8C0.81 2 0 2.77143 0 3.71429V12.2857C0 13.2286 0.81 14 1.8 14H16.2C17.19 14 18 13.2286 18 12.2857V3.71429C18 2.77143 17.19 2 16.2 2Z"
    />
  </svg>
);

const TreeRows = ({
  nodes,
  depth,
  currentFolderId,
  onSelectFolder,
  onNavigate,
}: {
  nodes: FolderTreeNode[];
  depth: number;
  currentFolderId?: string;
  onSelectFolder?: (folderId: string) => void;
  onNavigate: () => void;
}): ReactNode => (
  <ul className="flex flex-col gap-0.5">
    {nodes.map((node) => {
      const active = node.id === currentFolderId;
      const label = (
        <>
          {node.isFolder ? (
            <FolderGlyph className="size-3.5" />
          ) : (
            <FileText className="size-3.5 shrink-0 text-text-disabled" />
          )}
          <span className="truncate">{node.name}</span>
        </>
      );

      return (
        <li key={node.id}>
          {node.isFolder ? (
            <button
              type="button"
              onClick={() => {
                onSelectFolder?.(node.id);
                onNavigate();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-sm transition-colors',
                'hover:bg-bg-card focus-visible:bg-bg-card focus-visible:outline-none',
                active
                  ? 'bg-bg-card font-medium text-accent-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {label}
            </button>
          ) : (
            <div
              className={cn(
                'flex items-center gap-2 rounded-md py-1 pr-2 text-sm',
                active ? 'text-accent-primary' : 'text-text-secondary',
              )}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {label}
            </div>
          )}
          {node.children.length > 0 && (
            <TreeRows
              nodes={node.children}
              depth={depth + 1}
              currentFolderId={currentFolderId}
              onSelectFolder={onSelectFolder}
              onNavigate={onNavigate}
            />
          )}
        </li>
      );
    })}
  </ul>
);

export const FolderTreeMenu = ({
  currentFolderId,
  onSelectFolder,
  className,
}: FolderTreeMenuProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const [tree, setTree] = useState<FolderTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const text = useMemo(
    () => ({
      title: t('fileManager.directoryStructure'),
      loading: t('fileManager.directoryLoading'),
      empty: t('fileManager.directoryEmpty'),
    }),
    [t],
  );

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const nodes = await fetchFolderTree('', 0, { requests: 0 });
      setTree(nodes);
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || requested) return;
    setRequested(true);
    loadTree();
  }, [loadTree, open, requested]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const total = useMemo(() => countNodes(tree), [tree]);

  return (
    <div
      ref={rootRef}
      className={cn('relative inline-flex shrink-0 font-normal', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={text.title}
        data-testid="file-folder-tree-trigger"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40"
      >
        <FolderGlyph
          className={cn(
            'size-6 transition-transform duration-300',
            open ? 'scale-105' : '',
          )}
        />
      </button>

      <div
        className={cn(
          'absolute left-0 top-full z-30 pt-2 transition-all duration-200',
          open
            ? 'visible translate-y-0 opacity-100'
            : 'invisible -translate-y-1 opacity-0',
        )}
      >
        <div
          className="w-64 rounded-lg border border-border-button bg-bg-component p-1.5 shadow-lg"
          role="group"
          aria-label={text.title}
        >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1 text-xs text-text-disabled">
            <span>{text.title}</span>
            {total > 0 && <span className="tabular-nums">{total}</span>}
          </div>
          <div className="max-h-80 overflow-auto">
            {loading ? (
              <div className="px-2 py-1.5 text-sm text-text-disabled">
                {text.loading}
              </div>
            ) : tree.length > 0 ? (
              <TreeRows
                nodes={tree}
                depth={0}
                currentFolderId={currentFolderId}
                onSelectFolder={onSelectFolder}
                onNavigate={() => setOpen(false)}
              />
            ) : (
              <div className="px-2 py-1.5 text-sm text-text-disabled">
                {text.empty}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
