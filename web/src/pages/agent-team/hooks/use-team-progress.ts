import { useQuery } from '@tanstack/react-query';
import { IAgentTeamProgressEntry } from '@/interfaces/database/agent';
import { fetchTeamProgress } from '@/services/agent-service';

export const TeamProgressKeys = {
  detail: (taskId: string) => ['agent-team', 'progress', taskId] as const,
};

// 运行期进度由后端 team_progress 每分派一个子任务写一条，轮询即可驱动看板的
// "待分发 → 分发中 → 已完成/失败" 流动。只要还有 running 条目就继续轮询，
// 这样流结束那一刻写入的收尾记录也会被拉回来。
export const useTeamProgress = (taskId?: string, running = false) => {
  const { data, isFetching } = useQuery<IAgentTeamProgressEntry[]>({
    queryKey: TeamProgressKeys.detail(taskId ?? ''),
    queryFn: async () => {
      const { data } = await fetchTeamProgress({ task_id: taskId as string });
      return Array.isArray(data?.data)
        ? (data.data as IAgentTeamProgressEntry[])
        : [];
    },
    enabled: Boolean(taskId),
    refetchInterval: (query) => {
      const entries = query.state.data;
      const hasRunning = Array.isArray(entries)
        ? entries.some((entry) => entry.status === 'running')
        : false;
      return running || hasRunning ? 1000 : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  return { progress: data ?? [], loading: isFetching };
};
