/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

'use client';

import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import GlassFolder, {
  hashString,
  type ArtPreset,
  type FolderFile,
  type FolderMenuItem,
} from '@/components/glass-folder/glass-folder';
import { RenameDialog } from '@/components/rename-dialog';
import { useIsDarkTheme } from '@/components/theme-provider';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { useDownloadFile, useFetchFileList } from '@/hooks/use-file-request';
import { IFile } from '@/interfaces/database/file-manager';
import { formatFileSize } from '@/utils/common-util';
import { formatDate } from '@/utils/date';
import {
  getExtension,
  isSupportedPreviewDocumentType,
} from '@/utils/document-util';
import { pick } from 'lodash';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  UseHandleConnectToKnowledgeReturnType,
  useRenameCurrentFile,
} from './hooks';
import { LinkToDatasetDialog } from './link-to-dataset-dialog';
import { useHandleDeleteFile } from './use-delete-file';
import { UseMoveDocumentShowType } from './use-move-file';
import { useNavigateToOtherFolder } from './use-navigate-to-folder';
import {
  isFolderType,
  isKnowledgeBaseType,
  isSkillsFolder,
  sortFileList,
} from './util';
import { isGoDatasetBackend } from '@/utils/api-proxy-scheme';

const PRESETS: ArtPreset[] = ['aurora', 'ember', 'dusk', 'glacier', 'verdant'];

const CARD_WIDTH = 296;

type FolderGridProps = Pick<
  ReturnType<typeof useFetchFileList>,
  'files' | 'loading' | 'pagination' | 'setPagination' | 'total'
> &
  UseMoveDocumentShowType & {
    connectKnowledgeModal: UseHandleConnectToKnowledgeReturnType;
  };

export function FolderGrid({
  files,
  total,
  loading,
  pagination,
  setPagination,
  showMoveFileModal,
  connectKnowledgeModal,
}: FolderGridProps) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'fileManager',
  });
  const { t: tCommon } = useTranslation();
  const isDark = useIsDarkTheme();
  const navigate = useNavigate();
  const navigateToOtherFolder = useNavigateToOtherFolder();
  const { downloadFile } = useDownloadFile();
  const { handleRemoveFile } = useHandleDeleteFile();

  const {
    fileRenameVisible,
    showFileRenameModal,
    hideFileRenameModal,
    onFileRenameOk,
    initialFileName,
    fileRenameLoading,
  } = useRenameCurrentFile();

  const {
    connectToKnowledgeVisible,
    hideConnectToKnowledgeModal,
    showConnectToKnowledgeModal,
    initialConnectedIds,
    onConnectToKnowledgeOk,
    connectToKnowledgeLoading,
  } = connectKnowledgeModal;

  const [pendingDelete, setPendingDelete] = useState<IFile | null>(null);

  const isSkillsEnabled = useMemo(() => isGoDatasetBackend(), []);

  const { files: sortedFiles, hiddenCount } = useMemo(
    () => sortFileList(files ?? [], isSkillsEnabled),
    [files, isSkillsEnabled],
  );

  const displayTotal = Math.max((total ?? 0) - hiddenCount, 0);

  const handleShowConnectToKnowledgeModal = useCallback(
    (record: IFile) => {
      showConnectToKnowledgeModal(record);
    },
    [showConnectToKnowledgeModal],
  );

  const onRemoveFile = useCallback(async () => {
    if (!pendingDelete) return;
    const code = await handleRemoveFile([pendingDelete.id]);
    if (code === 0) {
      setPendingDelete(null);
    }
  }, [handleRemoveFile, pendingDelete]);

  const cardOf = (record: IFile, index: number) => {
    const folder = isFolderType(record.type);
    const skills = isSkillsFolder(record);
    const fromKnowledgeBase = isKnowledgeBaseType(record.source_type);
    const extension = getExtension(record.name);
    const previewable = isSupportedPreviewDocumentType(extension);
    const preset = PRESETS[hashString(record.name) % PRESETS.length];

    const sheets: FolderFile[] = folder
      ? []
      : [{ name: record.name, meta: formatFileSize(record.size) }];

    const menu: FolderMenuItem[] = [];

    if (!fromKnowledgeBase) {
      menu.push({
        label: t('addToKnowledge'),
        onSelect: () => handleShowConnectToKnowledgeModal(record),
      });
      menu.push({
        label: tCommon('common.rename'),
        onSelect: () => showFileRenameModal(record),
      });
      menu.push({
        label: tCommon('common.move'),
        onSelect: () => showMoveFileModal([record.id]),
      });
    }

    if (!folder) {
      menu.push({
        label: tCommon('common.download'),
        onSelect: () => downloadFile({ id: record.id, filename: record.name }),
      });
    }

    if (previewable) {
      menu.push({
        label: tCommon('common.preview'),
        onSelect: () =>
          window.open(
            '/document/' +
              record.id +
              '?ext=' +
              extension +
              '&resource=files',
            '_blank',
            'noreferrer',
          ),
      });
    }

    if (!fromKnowledgeBase) {
      menu.push({
        label: tCommon('common.delete'),
        danger: true,
        onSelect: () => setPendingDelete(record),
      });
    }

    const openFolder = (open: boolean) => {
      if (!open) return;
      if (skills) {
        navigate('/files/skills');
      } else {
        navigateToOtherFolder(record.id);
      }
    };

    return (
      <GlassFolder
        key={record.id}
        label={record.name}
        meta={folder ? t('folder') : formatDate(record.create_time)}
        tone={isDark ? 'dark' : 'light'}
        art={preset}
        seed={hashString(record.id) % 997}
        files={sheets}
        action={menu.length > 0 ? 'more' : 'none'}
        menu={menu}
        openLabel={tCommon('common.open')}
        closeLabel={tCommon('common.close')}
        ariaLabel={(folder ? tCommon('common.open') : tCommon('common.preview')) + ' ' + record.name}
        open={folder ? false : undefined}
        onOpenChange={folder ? openFolder : undefined}
        onFileSelect={() => {
          if (previewable) {
            window.open(
              '/document/' +
                record.id +
                '?ext=' +
                extension +
                '&resource=files',
              '_blank',
              'noreferrer',
            );
          } else if (!folder) {
            downloadFile({ id: record.id, filename: record.name });
          }
        }}
        width={CARD_WIDTH}
        appear
        appearDelay={Math.min(index, 6) * 70}
        labelPlacement="bottom-left"
      />
    );
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex flex-wrap gap-x-8 gap-y-10 pt-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse rounded-[26px] bg-bg-card"
                style={{ width: CARD_WIDTH, height: CARD_WIDTH * 0.96 }}
              />
            ))}
          </div>
        ) : sortedFiles.length > 0 ? (
          <div className="flex flex-wrap gap-x-8 gap-y-10 pt-2">
            {sortedFiles.map(cardOf)}
          </div>
        ) : (
          <div className="flex size-full min-h-60 items-center justify-center text-text-secondary">
            {tCommon('common.noResults')}
          </div>
        )}
      </div>

      <footer className="mt-4 flex items-center justify-end pb-5">
        <RAGFlowPagination
          {...pick(pagination, 'current', 'pageSize')}
          total={displayTotal}
          onChange={(page, pageSize) => {
            setPagination({ page, pageSize });
          }}
        />
      </footer>

      {connectToKnowledgeVisible && (
        <LinkToDatasetDialog
          hideModal={hideConnectToKnowledgeModal}
          initialConnectedIds={initialConnectedIds}
          onConnectToKnowledgeOk={onConnectToKnowledgeOk}
          loading={connectToKnowledgeLoading}
        ></LinkToDatasetDialog>
      )}
      {fileRenameVisible && (
        <RenameDialog
          hideModal={hideFileRenameModal}
          onOk={onFileRenameOk}
          initialName={initialFileName}
          loading={fileRenameLoading}
        ></RenameDialog>
      )}
      <ConfirmDeleteDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={tCommon('deleteModal.delFile')}
        onOk={onRemoveFile}
        content={{
          node: (
            <div className="truncate text-text-secondary">
              {pendingDelete?.name}
            </div>
          ),
        }}
      ></ConfirmDeleteDialog>
    </>
  );
}
