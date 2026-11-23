import { useMemo } from 'react';

import { useFetchAllKnowledgeList } from '@/hooks/use-knowledge-request';

import { sumDashboardTotals } from './utils';

export const useDashboardKnowledgeBases = () => {
  const { list, loading } = useFetchAllKnowledgeList();

  const totals = useMemo(() => sumDashboardTotals(list), [list]);

  return { knowledgeBases: list, totals, loading };
};
