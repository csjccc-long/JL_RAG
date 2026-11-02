import { TimelineNode } from '@/components/originui/timeline';
import Spotlight from '@/components/spotlight';
import { cn } from '@/lib/utils';
import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChunkResultBar from './components/chunk-result-bar';
import CheckboxSets from './components/chunk-result-bar/checkbox-sets';
import FormatPreserEditor from './components/parse-editer';
import RerunButton from './components/rerun-button';
import { TimelineNodeType } from './constant';
import { useChangeChunkTextMode } from './hooks';
import { IChunk } from '@/interfaces/database/dataset';
import { IDslComponent } from './interface';
import type { ParserEditorValue } from './components/parse-editer/interface';

const parserEditorKeys = [
  'text',
  'html',
  'markdown',
  'json',
  'chunks',
] as const;

function isParserEditorKey(key: string): key is ParserEditorValue['key'] {
  return parserEditorKeys.includes(key as (typeof parserEditorKeys)[number]);
}
interface IProps {
  isReadonly: boolean;
  isChange: boolean;
  setIsChange: (isChange: boolean) => void;
  step?: TimelineNode;
  data: { value: IDslComponent; key: string };
  reRunLoading: boolean;
  clickChunk: (chunk: IChunk) => void;
  summaryInfo: string;
  reRunFunc: (data: { value: IDslComponent; key: string }) => void;
}
const ParserContainer = (props: IProps) => {
  const {
    isChange,
    setIsChange,
    step,
    data,
    reRunFunc,
    reRunLoading,
    clickChunk,
    isReadonly,
    summaryInfo,
  } = props;
  const { t } = useTranslation();
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([]);
  const [newChunkIndex, setNewChunkIndex] = useState<number | undefined>();
  const { changeChunkTextMode, textMode } = useChangeChunkTextMode();
  const initialValue = useMemo<ParserEditorValue>(() => {
    const outputs = data.value.obj.params.outputs as unknown as Record<
      string,
      { type?: string; value?: unknown }
    >;
    const key = outputs.output_format?.value;
    if (typeof key !== 'string' || !isParserEditorKey(key)) {
      return { key: '', type: '', value: [] };
    }

    const output = outputs[key];
    const type = output?.type ?? '';
    const params = data.value.obj.params;

    if (key === 'json' || key === 'chunks') {
      const value = Array.isArray(output?.value)
        ? output.value.map((item) =>
            Object.fromEntries(
              Object.entries(item as Record<string, unknown>).map(([name, value]) => [
                name,
                String(value ?? ''),
              ]),
            ),
          )
        : [];
      return { key, type, value, params };
    }

    if (key !== 'text' && key !== 'html' && key !== 'markdown') {
      return { key: '', type: '', value: [] };
    }

    const value =
      typeof output?.value === 'string'
        ? output.value
        : String(output?.value ?? '');
    return { key, type, value, params };
  }, [data]);

  const [initialText, setInitialText] = useState<ParserEditorValue>(initialValue);

  useEffect(() => {
    setInitialText(initialValue);
  }, [initialValue]);
  const handleSave = (newContent: any) => {
    console.log('newContent-change-->', newContent, initialValue);
    if (JSON.stringify(newContent) !== JSON.stringify(initialValue)) {
      setIsChange(true);
      setInitialText(newContent);
    } else {
      setIsChange(false);
    }
    // Here, the API is called to send newContent to the backend
  };

  const handleReRunFunc = useCallback(() => {
    const newData: { value: IDslComponent; key: string } = {
      ...data,
      value: {
        ...data.value,
        obj: {
          ...data.value.obj,
          params: {
            ...(data.value?.obj?.params || {}),
            outputs: {
              ...(data.value?.obj?.params?.outputs || {}),
              [initialText.key]: {
                type: initialText.type,
                value: initialText.value,
              },
            },
          },
        },
      },
    };
    reRunFunc(newData);
    setIsChange(false);
  }, [data, initialText, reRunFunc, setIsChange]);

  const handleRemoveChunk = useCallback(async () => {
    if (
      selectedChunkIds.length > 0 &&
      Array.isArray(initialText.value)
    ) {
      initialText.value = initialText.value.filter(
        (_item, index) => !selectedChunkIds.includes(String(index)),
      );
      setIsChange(true);
      setSelectedChunkIds([]);
    }
  }, [selectedChunkIds, initialText, setIsChange]);

  const handleCheckboxClick = useCallback(
    (id: string | number, checked: boolean) => {
      setSelectedChunkIds((prev) => {
        if (checked) {
          return [...prev, id.toString()];
        } else {
          return prev.filter((item) => item.toString() !== id.toString());
        }
      });
    },
    [],
  );

  const selectAllChunk = useCallback(
    (checked: boolean) => {
      setSelectedChunkIds(
        checked && Array.isArray(initialText.value)
          ? initialText.value.map((_item, index) => String(index))
          : [],
      );
    },
    [initialText.value],
  );

  const isChunck =
    step?.type === TimelineNodeType.tokenChunker ||
    step?.type === TimelineNodeType.titleChunker;

  const handleCreateChunk = useCallback(
    (text: string) => {
      if (!Array.isArray(initialText.value)) return;
      const newText = [...initialText.value, { text: text || ' ' }];
      setNewChunkIndex(newText.length - 1);
      setInitialText({
        key: 'chunks',
        type: initialText.type,
        value: newText,
        params: initialText.params ?? data.value.obj.params,
      });
    },
    [data.value.obj.params, initialText],
  );

  useEffect(() => {
    if (newChunkIndex === undefined) return;
    const timer = setTimeout(() => setNewChunkIndex(undefined), 3000);
    return () => clearTimeout(timer);
  }, [newChunkIndex]);

  return (
    <>
      {isChange && !isReadonly && (
        <div className=" absolute top-2 right-6">
          <RerunButton
            step={step}
            onRerun={handleReRunFunc}
            loading={reRunLoading}
          />
        </div>
      )}
      <div className={classNames('flex flex-col w-full')}>
        {/* <Spin spinning={false} className="" size="large"> */}
        <div className="h-[50px] flex flex-col justify-end pb-[5px]">
          {!isChunck && (
            <div>
              <h2 className="text-[16px]">
                {t('dataflowParser.parseSummary')}
              </h2>
              <div className="text-[12px] text-text-secondary italic ">
                {/* {t('dataflowParser.parseSummaryTip')} */}
                {summaryInfo}
              </div>
            </div>
          )}
          {isChunck && (
            <div>
              <h2 className="text-[16px]">{t('dataflowParser.result')}</h2>
              <div className="text-[12px] text-text-secondary italic">
                {/* {t('chunk.chunkResultTip')} */}
              </div>
            </div>
          )}
        </div>

        {isChunck && (
          <div className="pt-[5px] pb-[5px] flex justify-between items-center">
            {!isReadonly && (
              <CheckboxSets
                selectAllChunk={selectAllChunk}
                removeChunk={handleRemoveChunk}
                checked={
                  Array.isArray(initialText.value) &&
                  selectedChunkIds.length === initialText.value.length
                }
                selectedChunkIds={selectedChunkIds}
              />
            )}
            <ChunkResultBar
              isReadonly={isReadonly}
              changeChunkTextMode={changeChunkTextMode}
              createChunk={handleCreateChunk}
            />
          </div>
        )}

        <div
          className={cn(
            ' border rounded-lg p-[20px] box-border w-[calc(100%-20px)] overflow-auto scrollbar-auto',
            {
              'h-[calc(100vh-240px)]': isChunck,
              'h-[calc(100vh-180px)]': !isChunck,
            },
          )}
        >
          {initialText && (
            <FormatPreserEditor
              initialValue={initialText}
              onSave={handleSave}
              isReadonly={isReadonly}
              isChunck={isChunck}
              textMode={textMode}
              isDelete={
                step?.type === TimelineNodeType.tokenChunker ||
                step?.type === TimelineNodeType.titleChunker
              }
              clickChunk={clickChunk}
              handleCheckboxClick={handleCheckboxClick}
              selectedChunkIds={selectedChunkIds}
              newChunkIndex={newChunkIndex}
            />
          )}
          <Spotlight opcity={0.6} coverage={60} />
        </div>
        {/* </Spin> */}
      </div>
    </>
  );
};
export default ParserContainer;
