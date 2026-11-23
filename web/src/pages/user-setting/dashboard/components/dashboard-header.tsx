import { LucidePlus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { Button } from '@/components/ui/button';
import { useFetchUserInfo } from '@/hooks/use-user-setting-request';
import { IDataset } from '@/interfaces/database/dataset';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';

import { DashboardView, DashboardViewType, sortKnowledgeBases } from '../utils';

type DashboardHeaderProps = {
  view: DashboardViewType;
  knowledgeBases: IDataset[];
  total: number;
  onViewChange: (view: DashboardViewType) => void;
};

const DashboardTabs = [
  { value: DashboardView.Updated, labelKey: 'setting.dashboard.tabs.updated' },
  { value: DashboardView.Created, labelKey: 'setting.dashboard.tabs.created' },
];

const AvatarStackSize = 4;

export function DashboardHeader({
  view,
  knowledgeBases,
  total,
  onViewChange,
}: DashboardHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: userInfo } = useFetchUserInfo();

  const tabHandlers = useMemo(
    () => ({
      [DashboardView.Updated]: () => onViewChange(DashboardView.Updated),
      [DashboardView.Created]: () => onViewChange(DashboardView.Created),
    }),
    [onViewChange],
  );

  const handleCreateClick = useCallback(() => {
    // The dataset list opens its creation dialog when this flag is present.
    navigate(Routes.Datasets + '?isCreate=true');
  }, [navigate]);

  const avatars = useMemo(
    () =>
      sortKnowledgeBases(knowledgeBases, DashboardView.Updated).slice(
        0,
        AvatarStackSize,
      ),
    [knowledgeBases],
  );

  const greeting = userInfo?.nickname
    ? t('setting.dashboard.welcome', { name: userInfo.nickname })
    : t('setting.dashboard.welcomeGuest');

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-medium text-text-primary">{greeting}</h2>

        <nav className="flex items-center gap-5">
          {DashboardTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={cn(
                'relative pb-1 text-sm transition-colors',
                view === tab.value
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              onClick={tabHandlers[tab.value]}
            >
              {t(tab.labelKey)}
              {view === tab.value && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-text-primary" />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2.5">
        {avatars.length > 0 && (
          <div className="flex items-center -space-x-2">
            {avatars.map((knowledgeBase) => (
              <RAGFlowAvatar
                key={knowledgeBase.id}
                name={knowledgeBase.name}
                avatar={knowledgeBase.avatar}
                className="size-7 ring-2 ring-bg-canvas"
              />
            ))}
          </div>
        )}

        <span className="whitespace-nowrap rounded-full bg-bg-card px-2.5 py-1 text-xs text-text-secondary">
          {t('setting.dashboard.bar.total', { value: total })}
        </span>

        <Button className="gap-1.5" onClick={handleCreateClick}>
          <LucidePlus className="size-4" />
          {t('setting.dashboard.actions.create')}
        </Button>
      </div>
    </header>
  );
}
