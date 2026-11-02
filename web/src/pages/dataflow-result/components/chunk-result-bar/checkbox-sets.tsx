import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LucideToggleLeft,
  LucideToggleRight,
  LucideTrash2,
} from 'lucide-react';

type ICheckboxSetProps = {
  className?: string;
  switchChunk?: (available: number) => void;
  selectAllChunk: (e: any) => void;
  removeChunk: (e?: any) => void;
  checked: boolean;
  selectedChunkIds: string[];
};
export default function CheckboxSets(props: ICheckboxSetProps) {
  const {
    className,
    selectAllChunk,
    removeChunk,
    switchChunk,
    checked,
    selectedChunkIds,
  } = props;
  const { t } = useTranslation();
  const handleSelectAllCheck = useCallback(
    (e: any) => {
      console.log('eee=', e);
      selectAllChunk(e);
    },
    [selectAllChunk],
  );

  const handleDeleteClick = useCallback(() => {
    removeChunk();
  }, [removeChunk]);

  const handleEnabledClick = useCallback(() => {
    switchChunk?.(1);
  }, [switchChunk]);

  const handleDisabledClick = useCallback(() => {
    switchChunk?.(0);
  }, [switchChunk]);

  const isSelected = useMemo(() => {
    return selectedChunkIds?.length > 0;
  }, [selectedChunkIds]);

  return (
    <div className={cn('flex gap-4 py-4 px-2', className)}>
      <div className="flex items-center gap-3 cursor-pointer text-muted-foreground hover:text-text-primary">
        <Checkbox
          id="all_chunks_checkbox"
          onCheckedChange={handleSelectAllCheck}
          checked={checked}
          className=" data-[state=checked]:bg-text-primary data-[state=checked]:border-text-primary data-[state=checked]:text-bg-base  border-muted-foreground text-muted-foreground hover:text-bg-base hover:border-text-primary "
        />
        <Label htmlFor="all_chunks_checkbox">{t('chunk.selectAll')}</Label>
      </div>
      {isSelected && (
        <>
          {switchChunk && (
            <>
              <Button variant="outline" onClick={handleEnabledClick}>
                <LucideToggleRight size={16} />
                {t('chunk.enable')}
              </Button>
              <Button variant="outline" onClick={handleDisabledClick}>
                <LucideToggleLeft size={16} />
                {t('chunk.disable')}
              </Button>
            </>
          )}
          <Button variant="danger" onClick={handleDeleteClick}>
            <LucideTrash2 className="size-[1em]" />
            {t('chunk.delete')}
          </Button>
        </>
      )}
    </div>
  );
}
