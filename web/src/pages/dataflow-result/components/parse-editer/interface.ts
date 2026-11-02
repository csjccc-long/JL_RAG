import { CheckedState } from '@radix-ui/react-checkbox';
import { IChunk } from '@/interfaces/database/dataset';
import { ChunkTextMode } from '../../constant';
import { ComponentParams } from '../../interface';
import { parserKeyMap } from './json-parser';

export type JsonEditorValue = {
  key: keyof typeof parserKeyMap;
  type: string;
  value: Array<Record<string, string>>;
  params: ComponentParams;
};

export type ObjectEditorValue = {
  key: 'text' | 'html' | 'markdown';
  type: string;
  value: string;
  params: ComponentParams;
};

export type ParserEditorValue =
  | JsonEditorValue
  | ObjectEditorValue
  | {
      key: '';
      type: '';
      value: [];
      params?: undefined;
    };

export interface FormatPreserveEditorProps {
  initialValue: ParserEditorValue;
  onSave: (value: any) => void;
  className?: string;
  isSelect?: boolean;
  isDelete?: boolean;
  isChunck?: boolean;
  handleCheckboxClick?: (id: string | number, checked: boolean) => void;
  selectedChunkIds?: string[];
  textMode?: ChunkTextMode;
  clickChunk: (chunk: IChunk) => void;
  isReadonly: boolean;
  newChunkIndex?: number;
}

export type IJsonContainerProps = {
  initialValue: JsonEditorValue;
  isChunck?: boolean;
  handleCheck: (e: CheckedState, index: number) => void;
  selectedChunkIds: string[] | undefined;
  unescapeNewlines: (text: string) => string;
  escapeNewlines: (text: string) => string;
  onSave: (data: {
    value: {
      text: string;
    }[];
    key: string;
    type: string;
  }) => void;
  className?: string;
  textMode?: ChunkTextMode;
  clickChunk: (chunk: IChunk) => void;
  isReadonly: boolean;
  newChunkIndex?: number;
};

export type IObjContainerProps = {
  initialValue: ObjectEditorValue;
  isChunck?: boolean;
  handleCheck: (e: CheckedState, index: number) => void;
  unescapeNewlines: (text: string) => string;
  escapeNewlines: (text: string) => string;
  onSave: (data: { value: string; key: string; type: string }) => void;
  className?: string;
  textMode?: ChunkTextMode;
  clickChunk: (chunk: IChunk) => void;
  isReadonly: boolean;
};
