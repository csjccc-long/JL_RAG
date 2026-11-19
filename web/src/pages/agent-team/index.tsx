import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Routes } from '@/routes';
import {
  ChangeEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import DispatchBoard from './dispatch-board';
import { useAgentTeams } from './hooks/use-agent-teams';
import { useTeamProgress } from './hooks/use-team-progress';
import { useTeamRun } from './hooks/use-team-run';
import ResultPanel from './result-panel';
import TeamList, { teamKey } from './team-list';
import { IDelegationLike, buildBoardCards } from './utils/board';
import { IAgentTeamSummary } from './utils/extract-teams';

/**
 * 多智能体协作台。
 *
 * 一个独立页面把"团队 → 任务分发 → 结果"摆在同一屏：左侧选团队，中间四列
 * 看板实时显示每个子任务的分发状态（后端 team_progress 通道，1s 轮询），
 * 右侧是团队结论与逐条分发记录。
 */
const AgentTeamPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { teams, loading, error: teamsError, refetch } = useAgentTeams();
  const { run, stop, running, taskId, snapshot, answer, error } = useTeamRun();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [task, setTask] = useState(searchParams.get('task') ?? '');
  const autoRunRef = useRef(false);

  const { progress } = useTeamProgress(taskId, running);

  const selectedTeam = useMemo(
    () => teams.find((team) => teamKey(team) === selectedKey),
    [teams, selectedKey],
  );

  // 深链：/agent-team?agentId=xxx 直接定位到那个团队。没有指定团队但带了任务
  // （聊天页判定为协作任务后跳转过来）时，优先生效层级协作台：它有主管在运行时
  // 决定派给谁，最能把一段任意任务拆开，比预设了固定子任务的团队更合适。
  useEffect(() => {
    if (teams.length === 0 || selectedKey) return;
    const targetAgentId = searchParams.get('agentId');
    const matched = targetAgentId
      ? teams.find((team) => team.agentId === targetAgentId)
      : undefined;
    const fromChat = searchParams.get('auto') === '1' && !!searchParams.get('task');
    const preferred =
      fromChat && !targetAgentId
        ? teams.find((team) => team.process === 'hierarchical') ?? teams[0]
        : teams[0];
    const fallback = matched ?? preferred;
    setSelectedKey(teamKey(fallback));
  }, [teams, selectedKey, searchParams]);

  const handleSelect = useCallback((_team: IAgentTeamSummary, key: string) => {
    setSelectedKey(key);
  }, []);

  const handleOpenCanvas = useCallback(
    (team: IAgentTeamSummary) => {
      navigate(`/agent/${team.agentId}`);
    },
    [navigate],
  );

  const handleRun = useCallback(() => {
    if (!selectedTeam || !task.trim() || running) return;
    run(selectedTeam.agentId, task.trim());
  }, [selectedTeam, task, running, run]);

  const handleTaskChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setTask(event.target.value);
    },
    [],
  );

  const handleTaskKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') handleRun();
    },
    [handleRun],
  );

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  // 从聊天页判定为协作任务跳转而来时，用户可能只是误入：给一条回到对话的路。
  const handleBackToChat = useCallback(() => {
    navigate(Routes.Chats);
  }, [navigate]);

  // 从聊天页跳过来时（auto=1）直接开始这次协作：用户是在对话里已经表达完
  // 需求才被带过来的，再让他点一次"分发任务"只会多一步。团队按键选择逻辑
  // 已经在上面的默认团队里定好（层级协作台优先）。
  useEffect(() => {
    if (autoRunRef.current) return;
    if (searchParams.get('auto') !== '1') return;
    if (!selectedTeam || !task.trim()) return;
    autoRunRef.current = true;
    run(selectedTeam.agentId, task.trim());
  }, [searchParams, selectedTeam, task, run]);

  const cards = useMemo(
    () =>
      buildBoardCards({
        progress,
        delegations: (snapshot?.outputs?.delegations ?? []) as IDelegationLike[],
        planTasks: selectedTeam?.tasks ?? [],
        workers: selectedTeam?.workers ?? [],
      }),
    [progress, snapshot, selectedTeam],
  );

  return (
    <section className="flex h-full flex-col gap-4 p-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">
              {t('flow.agentTeam.page.title')}
            </h1>
            <p className="mt-1 text-xs text-text-secondary">
              {t('flow.agentTeam.page.description')}
            </p>
          </div>
          <Button variant="transparent" onClick={handleBackToChat}>
            {t('flow.agentTeam.page.backToChat')}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={task}
            onChange={handleTaskChange}
            placeholder={t('flow.agentTeam.page.taskPlaceholder')}
            className="h-9 flex-1"
            onKeyDown={handleTaskKeyDown}
          />
          <Button
            className="shrink-0 whitespace-nowrap"
            onClick={handleRun}
            disabled={running || !selectedTeam}
          >
            {running
              ? t('flow.agentTeam.page.running')
              : t('flow.agentTeam.page.run')}
          </Button>
          {running && (
            <Button variant="transparent" onClick={stop}>
              {t('flow.agentTeam.page.stop')}
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_340px] gap-4">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-button">
          <div className="border-b border-border-button px-3 py-2 text-sm font-medium text-text-primary">
            {t('flow.agentTeam.page.teams')}
          </div>
          <div className="min-h-0 flex-1">
            {teamsError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
                <p className="text-xs text-text-secondary">
                  {t('flow.agentTeam.page.teamsError')}
                </p>
                <p className="break-all text-xs text-text-disabled">
                  {teamsError}
                </p>
                <Button variant="transparent" onClick={handleRetry}>
                  {t('flow.agentTeam.page.retry')}
                </Button>
              </div>
            ) : (
              <TeamList
                teams={teams}
                loading={loading}
                selectedKey={selectedKey}
                onSelect={handleSelect}
                onOpenCanvas={handleOpenCanvas}
              />
            )}
          </div>
        </div>

        <div className="min-h-0">
          <DispatchBoard cards={cards} />
        </div>

        <div className="min-h-0 overflow-hidden rounded-lg border border-border-button bg-bg-base">
          <ResultPanel
            team={selectedTeam}
            snapshot={snapshot}
            answer={answer}
            error={error}
            running={running}
          />
        </div>
      </div>
    </section>
  );
};

export default AgentTeamPage;