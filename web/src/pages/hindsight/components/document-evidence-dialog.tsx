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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spin } from '@/components/ui/spin';
import { useHindsightDocument } from '@/hooks/use-hindsight-request';
import { formatTime } from '@/utils/hindsight-util';
import { useTranslation } from 'react-i18next';

type DocumentEvidenceDialogProps = {
  bank: string;
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Traces one cited fact back to the retained document it was extracted from.
 * Kept in a dialog because the raw carrier is often much longer than the fact.
 */
const DocumentEvidenceDialog = ({
  bank,
  documentId,
  open,
  onOpenChange,
}: DocumentEvidenceDialogProps) => {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useHindsightDocument(
    bank,
    open ? documentId : '',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('hindsight.documentTitle')}</DialogTitle>
          <DialogDescription className="break-all">
            {documentId}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Spin />
        ) : isError ? (
          <p className="text-sm text-state-error">{(error as Error).message}</p>
        ) : (
          <div className="grid gap-3">
            <p className="whitespace-pre-wrap break-words text-sm text-text-primary">
              {data?.content || t('hindsight.documentEmpty')}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              {data?.tags?.length ? (
                <span>
                  {t('hindsight.evidenceTags')}: {data.tags.join(', ')}
                </span>
              ) : null}
              {data?.created_at ? (
                <span>
                  {t('hindsight.evidenceTime')}: {formatTime(data.created_at)}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DocumentEvidenceDialog;
