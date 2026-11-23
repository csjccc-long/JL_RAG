import { useCallback, useState } from 'react';

import { ContributionCard } from './components/contribution-card';
import { DashboardHeader } from './components/dashboard-header';
import { KnowledgeBarCard } from './components/knowledge-bar-card';
import { RecentKnowledgeCard } from './components/recent-knowledge-card';
import { TokenMeterCard } from './components/token-meter-card';
import { TokenTrendCard } from './components/token-trend-card';
import { useDashboardKnowledgeBases } from './hooks';
import { DashboardView, DashboardViewType } from './utils';

export default function DashboardPage() {
  const { knowledgeBases, totals, loading } = useDashboardKnowledgeBases();
  const [view, setView] = useState<DashboardViewType>(DashboardView.Updated);

  const handleViewChange = useCallback((nextView: DashboardViewType) => {
    setView(nextView);
  }, []);

  return (
    <section className="flex size-full flex-col gap-4 overflow-auto bg-bg-canvas p-4">
      <DashboardHeader
        view={view}
        knowledgeBases={knowledgeBases}
        total={totals.knowledgeBases}
        onViewChange={handleViewChange}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <RecentKnowledgeCard
          knowledgeBases={knowledgeBases}
          view={view}
          loading={loading}
        />
        <KnowledgeBarCard knowledgeBases={knowledgeBases} />
        <TokenTrendCard knowledgeBases={knowledgeBases} />
        <TokenMeterCard knowledgeBases={knowledgeBases} />
        <ContributionCard knowledgeBases={knowledgeBases} totals={totals} />
      </div>
    </section>
  );
}
