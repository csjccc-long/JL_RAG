import { UploadFormSchemaType } from '@/components/file-upload-dialog';
import { useSetModalState } from '@/hooks/common-hooks';
import {
  useRunDocument,
  useUploadDocument,
} from '@/hooks/use-document-request';
import { getUnSupportedFilesCount } from '@/utils/document-util';
import { useCallback, useState } from 'react';

/* The upload is over the moment 100% is reported; hold the dialog open a
   beat so the tick is actually seen landing on the file, then close. */
const SETTLE_MS = 900;

export const useHandleUploadDocument = () => {
  const {
    visible: documentUploadVisible,
    hideModal: hideDocumentUploadModal,
    showModal: showDocumentUploadModal,
  } = useSetModalState();
  const { uploadDocument, loading } = useUploadDocument();
  const { runDocumentByIds } = useRunDocument();
  const [progresses, setProgresses] = useState<Record<string, number>>({});
  const [completed, setCompleted] = useState<Record<string, boolean>>({});

  const trackProgress = useCallback((name: string, percent: number) => {
    setProgresses((prev) => ({ ...prev, [name]: percent }));
    if (percent >= 100) {
      setCompleted((prev) => ({ ...prev, [name]: true }));
    }
  }, []);

  const reset = useCallback(() => {
    setProgresses({});
    setCompleted({});
  }, []);

  const onDocumentUploadOk = useCallback(
    async ({
      fileList,
      parseOnCreation,
      tableColumnMode,
      tableColumnRoles,
    }: UploadFormSchemaType) => {
      if (fileList.length > 0) {
        // Build parser_config if column roles are configured
        let parserConfig: Record<string, any> | undefined;
        if (
          tableColumnMode === 'manual' &&
          tableColumnRoles &&
          Object.keys(tableColumnRoles).length > 0
        ) {
          parserConfig = {
            table_column_mode: 'manual',
            table_column_roles: tableColumnRoles,
          };
        }

        reset();

        const ret = await uploadDocument(
          fileList as File[],
          parserConfig,
          trackProgress,
        );

        // Check for success (code === 0) or partial success (code === 500 with some files)
        const isSuccess = ret?.code === 0;
        const isPartialSuccess = ret?.code === 500 && ret?.message;

        if (!isSuccess && !isPartialSuccess) {
          return;
        }

        // Trigger parsing for both full and partial success when parseOnCreation is enabled
        if (
          (isSuccess || isPartialSuccess) &&
          ret.data?.length > 0 &&
          parseOnCreation
        ) {
          runDocumentByIds({
            documentIds: ret.data.map((x: any) => x.id),
            run: 1,
          });
        }

        if (isSuccess) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          hideDocumentUploadModal();
          reset();
          return 0;
        }

        // For partial success (code 500), check if any files were uploaded
        const count = getUnSupportedFilesCount(ret?.message);
        if (count !== fileList.length) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          hideDocumentUploadModal();
          reset();
          return 0;
        }

        return ret?.code;
      }
    },
    [
      uploadDocument,
      runDocumentByIds,
      hideDocumentUploadModal,
      trackProgress,
      reset,
    ],
  );

  return {
    documentUploadLoading: loading,
    onDocumentUploadOk,
    documentUploadVisible,
    hideDocumentUploadModal,
    showDocumentUploadModal,
    uploadProgresses: progresses,
    uploadCompleted: completed,
  };
};
