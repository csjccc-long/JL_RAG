// https://github.com/sadmann7/file-uploader

'use client';

import { FileText, FolderUp } from 'lucide-react';
import * as React from 'react';
import Dropzone, {
  type DropzoneProps,
  type FileRejection,
} from 'react-dropzone';
import { toast } from 'sonner';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useControllableState } from '@/hooks/use-controllable-state';
import { useTranslation } from 'react-i18next';
import {
  type TrayRejection,
  UploadDropArea,
} from './file-upload-tray';
import { describeRejection } from './file-upload-tray/utils';

function isFileWithPreview(file: File): file is File & { preview: string } {
  return 'preview' in file && typeof file.preview === 'string';
}

interface FileUploaderProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'title'
> {
  /**
   * Value of the uploader.
   * @type File[]
   * @default undefined
   * @example value={files}
   */
  value?: File[];

  /**
   * Function to be called when the value changes.
   * @type (files: File[]) => void
   * @default undefined
   * @example onValueChange={(files) => setFiles(files)}
   */
  onValueChange?: (files: File[]) => void;

  /**
   * Function to be called when files are uploaded.
   * @type (files: File[]) => Promise<void>
   * @default undefined
   * @example onUpload={(files) => uploadFiles(files)}
   */
  onUpload?: (files: File[]) => Promise<void>;

  /**
   * Progress of the uploaded files.
   * @type Record<string, number> | undefined
   * @default undefined
   * @example progresses={{ "file1.png": 50 }}
   */
  progresses?: Record<string, number>;

  /**
   * Files whose upload has already finished, keyed by file name.
   * @type Record<string, boolean> | undefined
   * @default undefined
   */
  completed?: Record<string, boolean>;

  /**
   * Accepted file types for the uploader.
   * @type { [key: string]: string[]}
   * @default
   * ```ts
   * { "image/*": [] }
   * ```
   * @example accept={["image/png", "image/jpeg"]}
   */
  accept?: DropzoneProps['accept'];

  /**
   * Maximum file size for the uploader.
   * @type number | undefined
   * @default 1024 * 1024 * 10000000
   * @example maxSize={1024 * 1024 * 2} // 2MB
   */
  maxSize?: DropzoneProps['maxSize'];

  /**
   * Maximum number of files for the uploader.
   * @type number | undefined
   * @default 100000000000
   * @example maxFileCount={4}
   */
  maxFileCount?: DropzoneProps['maxFiles'];

  hideDropzoneOnMaxFileCount?: boolean;

  /**
   * Whether the folder tab should be shown in the uploader.
   * @type boolean
   * @default true
   * @example showFolderTab={false}
   */
  showFolderTab?: boolean;

  /**
   * Whether the uploader should accept multiple files.
   * @type boolean
   * @default false
   * @example multiple
   */
  multiple?: boolean;

  /**
   * Whether the uploader is disabled.
   * @type boolean
   * @default false
   * @example disabled
   */
  disabled?: boolean;

  title?: React.ReactNode;
  description?: React.ReactNode;
}

export function FileUploader(props: FileUploaderProps) {
  const {
    value: valueProp,
    onValueChange,
    onUpload,
    progresses,
    completed,
    accept = {
      'image/*': [],
    },
    maxSize = 1024 * 1024 * 10000000,
    maxFileCount = 100000000000,
    multiple = false,
    disabled = false,
    hideDropzoneOnMaxFileCount = false,
    showFolderTab = true,
    className,
    title,
    description,
    ...dropzoneProps
  } = props;
  const { t } = useTranslation();
  const [files, setFiles] = useControllableState({
    prop: valueProp,
    onChange: onValueChange,
  });

  const folderInputRef = React.useRef<HTMLInputElement>(null);
  const currentFiles = React.useMemo(() => files ?? [], [files]);
  const rejectionId = React.useRef(0);
  const [rejection, setRejection] = React.useState<TrayRejection | null>(null);

  const reject = React.useCallback(
    (key: string, values: Record<string, string | number>) => {
      rejectionId.current += 1;
      setRejection({ id: rejectionId.current, key, values });
    },
    [],
  );

  const reachesMaxFileCount = currentFiles.length >= maxFileCount;

  const processFiles = React.useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      if (!multiple && maxFileCount === 1 && acceptedFiles.length > 1) {
        reject('fileManager.rejectedCount', { max: 1 });
        return;
      }

      if (currentFiles.length + acceptedFiles.length > maxFileCount) {
        reject('fileManager.rejectedCount', { max: maxFileCount });
        return;
      }

      if (rejectedFiles.length > 0) {
        const [first] = rejectedFiles;
        const code =
          first.errors[0]?.code === 'file-too-large'
            ? 'file-too-large'
            : first.errors[0]?.code === 'file-invalid-type'
              ? 'file-invalid-type'
              : 'too-many-files';
        const descriptor = describeRejection(
          { name: first.file.name, size: first.file.size, code },
          { maxSize, maxFileCount },
        );
        reject(descriptor.key, descriptor.values);
      }

      if (!rejectedFiles.length) setRejection(null);
      if (!acceptedFiles.length) return;

      const newFiles = acceptedFiles.map((file) => {
        const enhancedFile = file as File & { preview?: string };
        Object.defineProperty(enhancedFile, 'preview', {
          value: URL.createObjectURL(file),
          writable: true,
          enumerable: true,
          configurable: true,
        });
        return enhancedFile;
      });

      const updatedFiles = [...currentFiles, ...newFiles];

      setFiles(updatedFiles);

      if (
        onUpload &&
        updatedFiles.length > 0 &&
        updatedFiles.length <= maxFileCount
      ) {
        const target =
          updatedFiles.length > 0 ? `${updatedFiles.length} files` : `file`;

        toast.promise(onUpload(updatedFiles), {
          loading: `Uploading ${target}...`,
          success: () => {
            setFiles([]);
            return `${target} uploaded`;
          },
          error: `Failed to upload ${target}`,
        });
      }
    },
    [
      currentFiles,
      maxFileCount,
      maxSize,
      multiple,
      onUpload,
      reject,
      setFiles,
    ],
  );

  const onDrop = React.useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      processFiles(acceptedFiles, rejectedFiles);
    },
    [processFiles],
  );

  const handleFolderSelect = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const fileList = Array.from(e.target.files);
      processFiles(fileList, []);
      e.target.value = '';
    },
    [processFiles],
  );

  const onRemove = React.useCallback(
    (index: number) => {
      const newFiles = currentFiles.filter((_, i) => i !== index);
      setFiles(newFiles);
      onValueChange?.(newFiles);
    },
    [currentFiles, onValueChange, setFiles],
  );

  const onClear = React.useCallback(() => {
    currentFiles.forEach((file) => {
      if (isFileWithPreview(file)) URL.revokeObjectURL(file.preview);
    });
    setFiles([]);
    onValueChange?.([]);
    setRejection(null);
  }, [currentFiles, onValueChange, setFiles]);

  // Revoke preview url when component unmounts
  React.useEffect(() => {
    return () => {
      if (!files) return;
      files.forEach((file) => {
        if (isFileWithPreview(file)) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  const isDisabled = disabled || reachesMaxFileCount;

  const renderDropzone = (isFolderMode: boolean = false) => (
    <Dropzone
      onDrop={onDrop}
      accept={isFolderMode ? undefined : accept}
      maxSize={maxSize}
      maxFiles={maxFileCount}
      multiple={maxFileCount > 1 || multiple}
      disabled={isDisabled}
      noClick={isFolderMode}
      noDrag={isFolderMode}
    >
      {({ getRootProps, getInputProps, isDragActive }) => {
        const {
          ref: dropRef,
          ...rootDomProps
        } = getRootProps() as React.HTMLAttributes<HTMLDivElement> & {
          ref?: React.Ref<HTMLDivElement>;
        };

        return (
          <UploadDropArea
            files={currentFiles}
            progresses={progresses}
            completed={completed}
            rejection={rejection}
            isDragActive={isDragActive}
            isFolderMode={isFolderMode}
            disabled={isDisabled}
            maxFileCount={maxFileCount}
            maxSize={maxSize}
            title={title}
            description={description}
            className={className}
            rootRef={dropRef}
            rootProps={{ ...rootDomProps, ...dropzoneProps }}
            inputProps={
              isFolderMode
                ? undefined
                : (getInputProps() as React.InputHTMLAttributes<HTMLInputElement> & {
                    ref?: React.Ref<HTMLInputElement>;
                  })
            }
            onActivate={() => folderInputRef.current?.click()}
            onRemove={onRemove}
            onClear={onClear}
          />
        );
      }}
    </Dropzone>
  );

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden">
      {!(hideDropzoneOnMaxFileCount && reachesMaxFileCount) && (
        <Tabs defaultValue="file" className="w-full">
          <TabsList className="w-fit justify-start">
            <TabsTrigger value="file" className="gap-2">
              <FileText className="size-4" />
              {t('fileManager.files', 'Files')}
            </TabsTrigger>
            {showFolderTab && (
              <TabsTrigger value="folder" className="gap-2">
                <FolderUp className="size-4" />
                {t('fileManager.folder', 'Folder')}
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="file" className="mt-1">
            {renderDropzone(false)}
          </TabsContent>
          {showFolderTab && (
            <TabsContent value="folder" className="mt-1">
              {renderDropzone(true)}
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={handleFolderSelect}
                {...{
                  webkitdirectory: '',
                  directory: '',
                }}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
