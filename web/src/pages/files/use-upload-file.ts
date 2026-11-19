import { UploadFormSchemaType } from '@/components/file-upload-dialog';
import { useSetModalState } from '@/hooks/common-hooks';
import { useUploadFile } from '@/hooks/use-file-request';
import { useCallback, useState } from 'react';
import { useGetFolderId } from './hooks';

/* The upload is over the moment 100% is reported; hold the dialog open a
   beat so the tick is actually seen landing on the file, then close. */
const SETTLE_MS = 900;

export const useHandleUploadFile = () => {
  const {
    visible: fileUploadVisible,
    hideModal: hideFileUploadModal,
    showModal: showFileUploadModal,
  } = useSetModalState();
  const { uploadFile, loading } = useUploadFile();
  const id = useGetFolderId();
  const [progresses, setProgresses] = useState<Record<string, number>>({});
  const [completed, setCompleted] = useState<Record<string, boolean>>({});

  const trackProgress = useCallback((name: string, percent: number) => {
    setProgresses((prev) => ({ ...prev, [name]: percent }));
    if (percent >= 100) {
      setCompleted((prev) => ({ ...prev, [name]: true }));
    }
  }, []);

  const onFileUploadOk = useCallback(
    async ({ fileList }: UploadFormSchemaType): Promise<number | undefined> => {
      if (fileList.length > 0) {
        setProgresses({});
        setCompleted({});

        const ret: number | undefined = await uploadFile({
          fileList,
          parentId: id,
          onProgress: trackProgress,
        });

        if (ret === 0) {
          await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
          hideFileUploadModal();
          setProgresses({});
          setCompleted({});
        }

        return ret;
      }
    },
    [uploadFile, hideFileUploadModal, id, trackProgress],
  );

  return {
    fileUploadLoading: loading,
    onFileUploadOk,
    fileUploadVisible,
    hideFileUploadModal,
    showFileUploadModal,
    uploadProgresses: progresses,
    uploadCompleted: completed,
  };
};
