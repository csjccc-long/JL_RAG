import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Radio } from '@/components/ui/radio';
import { useTranslate } from '@/hooks/common-hooks';
import { cn } from '@/lib/utils';
import { LucideFilter, Plus } from 'lucide-react';
import { useState } from 'react';
import { ChunkTextMode } from '../../constant';
interface ChunkResultBarProps {
  className?: string;
  available?: number;
  selectAllChunk?: (value: boolean) => void;
  handleSetAvailable?: (value: number | undefined) => void;
  handleInputChange?: React.ChangeEventHandler<HTMLInputElement>;
  searchString?: string;
  changeChunkTextMode: (mode: ChunkTextMode) => void;
  createChunk: (text: string) => void;
  isReadonly: boolean;
}
export default function ChunkResultBar({
  className,
  available,
  selectAllChunk,
  handleSetAvailable,
  handleInputChange,
  searchString = '',
  changeChunkTextMode,
  createChunk,
  isReadonly,
}: ChunkResultBarProps) {
  const { t } = useTranslate('chunk');
  const [textSelectValue, setTextSelectValue] = useState<ChunkTextMode>(
    ChunkTextMode.Full,
  );
  const textSelectOptions = [
    { label: t(ChunkTextMode.Full), value: ChunkTextMode.Full },
    { label: t(ChunkTextMode.Ellipse), value: ChunkTextMode.Ellipse },
  ];

  const handleFilterChange = (value: string | number) => {
    selectAllChunk?.(false);
    handleSetAvailable?.(value === -1 ? undefined : Number(value));
  };

  const changeTextSelectValue = (value: ChunkTextMode) => {
    setTextSelectValue(value);
    changeChunkTextMode(value);
  };
  return (
    <div className={cn('flex gap-2', className)}>
      <div className="flex items-center gap-1 bg-bg-card text-muted-foreground w-fit h-[35px] rounded-md p-1">
        {textSelectOptions.map((option) => (
          <div
            key={option.value}
            className={cn(
              'flex items-center cursor-pointer px-4 py-1 rounded-md',
              {
                'text-primary bg-bg-base': option.value === textSelectValue,
                'text-text-primary': option.value !== textSelectValue,
              },
            )}
            onClick={() => changeTextSelectValue(option.value)}
          >
            {option.label}
          </div>
        ))}
      </div>
      {handleInputChange && (
        <SearchInput
          className="w-28"
          placeholder={t('search')}
          onChange={handleInputChange}
          value={searchString}
        />
      )}
      {selectAllChunk && handleSetAvailable && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon">
              <LucideFilter />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[200px]">
            <Radio.Group
              onChange={handleFilterChange}
              value={available ?? -1}
            >
              <div className="flex flex-col gap-2 p-4">
                <Radio value={-1}>{t('all')}</Radio>
                <Radio value={1}>{t('enabled')}</Radio>
                <Radio value={0}>{t('disabled')}</Radio>
              </div>
            </Radio.Group>
          </PopoverContent>
        </Popover>
      )}
      {!isReadonly && (
        <Button
          onClick={() => createChunk('')}
          variant={'secondary'}
          className="bg-bg-card text-muted-foreground hover:bg-card"
        >
          <Plus size={44} />
        </Button>
      )}
    </div>
  );
}
