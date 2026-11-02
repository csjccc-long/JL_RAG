import { FilterCollection } from '@/components/list-filter-bar/interface';
import { useGetDatasetFilter } from '@/hooks/use-knowledge-request';
import { isGoDatasetBackend } from '@/utils/api-proxy-scheme';
import { useTranslation } from 'react-i18next';

export function useSelectOwners() {
  const { filter } = useGetDatasetFilter();
  const { t } = useTranslation();

  // Only the Go backend exposes the owner facet, so the owner filter is
  // hidden instead of rendering an empty dropdown.
  if (!isGoDatasetBackend()) {
    return [];
  }

  const filters: FilterCollection[] = [
    { field: 'owner', list: filter.owner, label: t('common.owner') },
  ];

  return filters;
}
