import { BulkOperateBar } from '@/components/bulk-operate-bar';
import { FileUploadDialog } from '@/components/file-upload-dialog';
import ListFilterBar from '@/components/list-filter-bar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Segmented, SegmentedValue } from '@/components/ui/segmented';
import { useRowSelection } from '@/hooks/logic-hooks/use-row-selection';
import { useFetchFileList, useGetFolderId } from '@/hooks/use-file-request';
import { LayoutGrid, List, LucidePlus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreateFolderDialog } from './create-folder-dialog';
import { FileBreadcrumb } from './file-breadcrumb';
import { FilesTable } from './files-table';
import { FolderGrid } from './folder-grid';
import { FolderTreeMenu } from './folder-tree-menu';
import {
  useHandleConnectToKnowledge,
  UseHandleConnectToKnowledgeReturnType,
} from './hooks';
import { MoveDialog } from './move-dialog';
import { useBulkOperateFile } from './use-bulk-operate-file';
import { useHandleCreateFolder } from './use-create-folder';
import { useHandleMoveFile } from './use-move-file';
import {
  useNavigateToOtherFolder,
  useSelectBreadcrumbItems,
} from './use-navigate-to-folder';
import { useHandleUploadFile } from './use-upload-file';

type FileViewMode = 'list' | 'cards';

const VIEW_MODE_STORAGE_KEY = 'ragflow.files.view-mode';

const getStoredViewMode = (): FileViewMode => {
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'cards'
      ? 'cards'
      : 'list';
  } catch {
    return 'list';
  }
};

export default function Files() {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<FileViewMode>(getStoredViewMode);

  const handleViewModeChange = useCallback((value: SegmentedValue) => {
    const next: FileViewMode = value === 'cards' ? 'cards' : 'list';
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // A blocked storage only costs the preference, never the view.
    }
  }, []);

  const {
    fileUploadVisible,
    hideFileUploadModal,
    showFileUploadModal,
    fileUploadLoading,
    onFileUploadOk,
  } = useHandleUploadFile();

  const {
    folderCreateModalVisible,
    showFolderCreateModal,
    hideFolderCreateModal,
    folderCreateLoading,
    onFolderCreateOk,
  } = useHandleCreateFolder();

  const {
    pagination,
    files,
    total,
    loading,
    setPagination,
    searchString,
    handleInputChange,
  } = useFetchFileList();

  const {
    rowSelection,
    setRowSelection,
    rowSelectionIsEmpty,
    clearRowSelection,
    selectedCount,
  } = useRowSelection();

  const {
    showMoveFileModal,
    moveFileVisible,
    onMoveFileOk,
    hideMoveFileModal,
    moveFileLoading,
  } = useHandleMoveFile({ clearRowSelection });

  const connectKnowledgeModal: UseHandleConnectToKnowledgeReturnType =
    useHandleConnectToKnowledge();

  const { list } = useBulkOperateFile({
    files,
    rowSelection,
    showMoveFileModal,
    setRowSelection,
    showConnectToKnowledgeModal:
      connectKnowledgeModal.showConnectToKnowledgeModal,
  });

  const breadcrumbItems = useSelectBreadcrumbItems();
  const folderId = useGetFolderId();
  const navigateToOtherFolder = useNavigateToOtherFolder();

  const leftPanel = (
    <div>
      {breadcrumbItems.length > 0 ? (
        <FileBreadcrumb></FileBreadcrumb>
      ) : (
        t('fileManager.files')
      )}
    </div>
  );

  const viewModeSwitch = (
    <Segmented
      value={viewMode}
      onChange={handleViewModeChange}
      options={[
        {
          value: 'list',
          label: <List className="size-4" />,
          title: t('fileManager.listView'),
        },
        {
          value: 'cards',
          label: <LayoutGrid className="size-4" />,
          title: t('fileManager.cardView'),
        },
      ]}
    ></Segmented>
  );

  return (
    <article
      className="size-full min-w-0 flex flex-col"
      data-testid="files-list"
      data-view-mode={viewMode}
    >
      <header className="mb-4 min-w-0 px-5 pt-8">
        <ListFilterBar
          leftPanel={leftPanel}
          searchString={searchString}
          onSearchChange={handleInputChange}
          showFilter={false}
          icon={
            <FolderTreeMenu
              currentFolderId={folderId}
              onSelectFolder={navigateToOtherFolder}
            />
          }
          preChildren={viewModeSwitch}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <LucidePlus />
                {t('knowledgeDetails.addFile')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem onClick={showFileUploadModal}>
                {t('fileManager.uploadFile')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={showFolderCreateModal}>
                {t('fileManager.newFolder')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ListFilterBar>

        {viewMode === 'list' && !rowSelectionIsEmpty && (
          <BulkOperateBar className="mt-4" list={list} count={selectedCount} />
        )}
      </header>

      <div className="flex-1 px-5 flex flex-col overflow-hidden">
        {viewMode === 'list' ? (
          <FilesTable
            files={files}
            total={total}
            pagination={pagination}
            setPagination={setPagination}
            loading={loading}
            rowSelection={rowSelection}
            setRowSelection={setRowSelection}
            showMoveFileModal={showMoveFileModal}
            connectKnowledgeModal={connectKnowledgeModal}
          />
        ) : (
          <FolderGrid
            files={files}
            total={total}
            pagination={pagination}
            setPagination={setPagination}
            loading={loading}
            showMoveFileModal={showMoveFileModal}
            connectKnowledgeModal={connectKnowledgeModal}
          />
        )}
      </div>

      {fileUploadVisible && (
        <FileUploadDialog
          hideModal={hideFileUploadModal}
          onOk={onFileUploadOk}
          loading={fileUploadLoading}
        ></FileUploadDialog>
      )}
      {folderCreateModalVisible && (
        <CreateFolderDialog
          loading={folderCreateLoading}
          visible={folderCreateModalVisible}
          hideModal={hideFolderCreateModal}
          onOk={onFolderCreateOk}
        ></CreateFolderDialog>
      )}
      {moveFileVisible && (
        <MoveDialog
          hideModal={hideMoveFileModal}
          onOk={onMoveFileOk}
          loading={moveFileLoading}
        ></MoveDialog>
      )}
    </article>
  );
}
