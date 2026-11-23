import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ITeamRunSnapshot } from './hooks/use-team-run';
import ResultPanel from './result-panel';
import { IAgentTeamSummary } from './utils/extract-teams';

interface ResultDrawerProps {
  team?: IAgentTeamSummary;
  snapshot?: ITeamRunSnapshot;
  answer: string;
  error: string;
  running: boolean;
}

/**
 * 结论抽屉：平时只留一条标题栏，鼠标移上去或这次协作跑完才铺开。
 *
 * 结果面板占着整条右栏的时候，右上角那块"分发盘"就没地方放了；所以把结论
 * 收成贴着栏底的一张卡片，往上抽出来时盖住盘面——盘是常驻的舞台，结论是
 * 用完就收的记录。
 */
const ResultDrawer = ({ team, snapshot, answer, error, running }: ResultDrawerProps) => {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);

  const failed = Boolean(error) || String(snapshot?.outputs?._ERROR ?? '') !== '';
  const finished = !running && Boolean(snapshot || answer || error);

  // 一次协作跑完就把结论推上来：用户不用去猜抽屉在哪，也不用先悬停。
  useEffect(() => {
    if (finished) setOpen(true);
  }, [finished]);

  const expanded = open || hovered;

  const handleToggle = () => {
    setOpen((previous) => !previous);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`pointer-events-auto flex flex-col overflow-hidden border border-border-button bg-bg-base shadow-sm transition-all duration-300 ease-out ${
          expanded ? 'h-[76%] rounded-lg' : 'h-11 rounded-lg'
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={handleToggle}
          className="flex h-11 shrink-0 items-center justify-between gap-2 px-3 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">
              {t('flow.agentTeam.page.result')}
            </span>
            {running && (
              <Badge variant="default">{t('flow.agentTeam.status.running')}</Badge>
            )}
            {finished && !failed && (
              <Badge variant="success">{t('flow.agentTeam.status.success')}</Badge>
            )}
            {finished && failed && (
              <Badge variant="destructive">{t('flow.agentTeam.status.failed')}</Badge>
            )}
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" />
          ) : (
            <ChevronUp className="h-4 w-4 shrink-0 text-text-secondary" />
          )}
        </button>

        <div
          className={`min-h-0 flex-1 transition-opacity duration-200 ${
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <ResultPanel
            team={team}
            snapshot={snapshot}
            answer={answer}
            error={error}
            running={running}
          />
        </div>
      </div>
    </div>
  );
};

export default ResultDrawer;