import { Button } from '@/components/ui/button';
import { Routes } from '@/routes';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import DispatchBoard from './dispatch-board';
import DispatchSeek from './dispatch-seek';
import NewTeamDialog from './new-team-dialog';
import { AgentTeamProcess } from '@/interfaces/database/agent';
import { useAgentRoster } from './hooks/use-agent-roster';
import { useAssignWorkers } from './hooks/use-assign-workers';
import { useAgentTeams } from './hooks/use-agent-teams';
import { useSetProcess } from './hooks/use-set-process';
import ProcessMenu from './process-menu';
import { useTeamProgress } from './hooks/use-team-progress';
import { useTeamRun } from './hooks/use-team-run';
import ResultDial from './result-dial';
import ResultDrawer from './result-drawer';
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
  const { roster } = useAgentRoster();
  const assign = useAssignWorkers();
  const setProcess = useSetProcess();
  const { run, stop, running, taskId, snapshot, answer, error } = useTeamRun();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [task, setTask] = useState(searchParams.get('task') ?? '');
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<string>();
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

  // 新建的团队要立刻被选中：列表是异步刷新的，所以记下刚建好的 agentId，
  // 等它出现在 teams 里再定位，而不是拿着还没被解析出来的信息去拼 key。
  useEffect(() => {
    if (!pendingAgent) return;
    const created = teams.find((team) => team.agentId === pendingAgent);
    if (!created) return;
    setSelectedKey(teamKey(created));
    setPendingAgent(undefined);
  }, [teams, pendingAgent]);

  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleCreated = useCallback((agentId: string) => {
    setCreateOpen(false);
    setPendingAgent(agentId);
  }, []);

  // 协作的成员来自"已经建好的智能体"，不是在这里现写一份配置：选择结果写回
  // 团队节点自身的 workers，画布与看板读的是同一份。
  const handleAssign = useCallback(
    (team: IAgentTeamSummary, workerIds: string[]) => {
      assign.mutate({ team, workerIds });
    },
    [assign],
  );

  // 协作方式属于团队本身，执行前可改、执行中锁定：改的是画布上的那一份定义，
  // 看板与画布因此永远读同一个 process。
  const handleProcessChange = useCallback(
    (process: AgentTeamProcess) => {
      if (!selectedTeam || running) return;
      setProcess.mutate({
        team: selectedTeam,
        process,
        seed: {
          task: (worker) =>
            t('flow.agentTeam.page.seedTask', {
              name: worker.name || worker.id,
            }),
          expected: t('flow.agentTeam.page.seedExpected'),
          manager: t('flow.agentTeam.page.seedManager', {
            name: selectedTeam.agentTitle,
          }),
        },
      });
    },
    [running, selectedTeam, setProcess, t],
  );

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
        <div className="relative z-20 flex items-center gap-2">
          {selectedTeam && (
            <ProcessMenu
              value={selectedTeam.process}
              locked={running}
              saving={setProcess.isPending}
              onChange={handleProcessChange}
            />
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <DispatchSeek
              value={task}
              placeholder={t('flow.agentTeam.page.taskPlaceholder')}
              label={
                running
                  ? t('flow.agentTeam.page.running')
                  : t('flow.agentTeam.page.run')
              }
              running={running}
              disabled={!selectedTeam}
              onChange={setTask}
              onSubmit={handleRun}
            />
            {running && (
              <Button variant="transparent" onClick={stop}>
                {t('flow.agentTeam.page.stop')}
              </Button>
            )}
          </div>
        </div>
        {setProcess.error ? (
          <p className="text-xs text-state-error">
            {t('flow.agentTeam.page.processFailed')}
          </p>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_340px] gap-4">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border-button">
          <div className="flex items-center justify-between gap-2 border-b border-border-button py-1.5 pl-3 pr-2">
            <span className="text-sm font-medium text-text-primary">
              {t('flow.agentTeam.page.teams')}
            </span>
            <button
              type="button"
              data-testid="new-team"
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-accent hover:text-text-primary"
              onClick={handleOpenCreate}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('flow.agentTeam.page.newTeamCta')}
            </button>
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
                roster={roster}
                onAssign={handleAssign}
                assigningKey={
                  assign.isPending ? teamKey(assign.variables!.team) : undefined
                }
                assignFailedKey={
                  assign.error && assign.variables
                    ? teamKey(assign.variables.team)
                    : undefined
                }
                assignFailure={assign.error?.message}
              />
            )}
          </div>
        </div>

        <div className="min-h-0">
          <DispatchBoard cards={cards} />
        </div>

        <div className="relative min-h-0 overflow-hidden">
          <ResultDial />
          <ResultDrawer
            team={selectedTeam}
            snapshot={snapshot}
            answer={answer}
            error={error}
            running={running}
          />
        </div>
      </div>

      <NewTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roster={roster}
        taken={teams.map((team) => team.agentTitle)}
        onCreated={handleCreated}
      />
    </section>
  );
};

export default AgentTeamPage;