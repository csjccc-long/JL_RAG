import { SharedBadge } from '@/components/shared-badge';
import { MoreButton } from '@/components/more-button';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { IDataset } from '@/interfaces/database/dataset';
import { formatDate } from '@/utils/date';
import { t } from 'i18next';
import { ChevronRight } from 'lucide-react';
import { DatasetDisk } from './dataset-disk';
import { DatasetDropdown } from './dataset-dropdown';
import { useRenameDataset } from './use-rename-dataset';

export type DatasetCardProps = {
  dataset: IDataset;
} & Pick<ReturnType<typeof useRenameDataset>, 'showDatasetRenameModal'>;

export function DatasetCard({
  dataset,
  showDatasetRenameModal,
}: DatasetCardProps) {
  const { navigateToDataset } = useNavigatePage();

  return (
    <DatasetDisk
      name={dataset.name}
      files={`${dataset.document_count} ${t('knowledgeDetails.files')}`}
      date={formatDate(dataset.update_time)}
      badge={<SharedBadge>{dataset.nickname}</SharedBadge>}
      more={
        <DatasetDropdown
          showDatasetRenameModal={showDatasetRenameModal}
          dataset={dataset}
        >
          <MoreButton></MoreButton>
        </DatasetDropdown>
      }
      onClick={navigateToDataset(dataset.id)}
    />
  );
}

export function SeeAllCard() {
  const { navigateToDatasetList } = useNavigatePage();

  return (
    <Card
      className="w-full flex-none h-full cursor-pointer"
      onClick={() => navigateToDatasetList({ isCreate: false })}
    >
      <CardContent className="p-2.5 pt-1 w-full h-full flex items-center justify-center gap-1.5 text-text-secondary">
        {t('common.seeAll')} <ChevronRight className="size-4" />
      </CardContent>
    </Card>
  );
}
