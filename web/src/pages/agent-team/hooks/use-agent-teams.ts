import { useQuery } from '@tanstack/react-query';
import { AgentCategory } from '@/constants/agent';
import { AgentListItem } from '@/interfaces/database/agent';
import agentService from '@/services/agent-service';
import { extractTeamNodes, IAgentTeamSummary } from '../utils/extract-teams';

export const AgentTeamKeys = {
  list: () => ['agent-team', 'list'] as const,
};

// 后端 /agents 对 page_size 有硬上限（api/utils/pagination_utils.py:
// REST_API_MAX_PAGE_SIZE = 100），超过会抛 ValueError('page_size must be less
// than or equal to 100')。这里按 100 一页翻到底，避免画布多了就整页报错。
export const AGENT_TEAM_PAGE_SIZE = 100;
const MAX_PAGES = 20;

export const listAllAgentCanvases = async (): Promise<AgentListItem[]> => {
  const canvases: AgentListItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await agentService.listAgents(
      {
        params: {
          page,
          page_size: AGENT_TEAM_PAGE_SIZE,
          canvas_category: AgentCategory.AgentCanvas,
        },
      },
      true,
    );

    const batch: AgentListItem[] = data?.data?.canvas ?? [];
    canvases.push(...batch);

    const total = Number(data?.data?.total ?? 0);
    if (batch.length < AGENT_TEAM_PAGE_SIZE) break;
    if (total > 0 && canvases.length >= total) break;
  }

  return canvases;
};

// 列表接口不返回 dsl，团队信息只能逐个取详情解析；画布数量很少（团队场景通常
// 只有几个），并发请求可以接受。
export const loadTeams = async (): Promise<IAgentTeamSummary[]> => {
  const agents = await listAllAgentCanvases();

  const details = await Promise.all(
    agents.map(async (agent) => {
      try {
        const { data: detail } = await agentService.getAgent(agent.id);
        return { agent, dsl: detail?.data?.dsl };
      } catch {
        return { agent, dsl: undefined };
      }
    }),
  );

  return details.flatMap(({ agent, dsl }) =>
    extractTeamNodes(dsl).map((node) => ({
      ...node,
      agentId: agent.id,
      agentTitle: (agent as { title?: string }).title || agent.id,
    })),
  );
};

export const useAgentTeams = () => {
  const { data, isFetching, error, refetch } = useQuery<IAgentTeamSummary[]>({
    queryKey: AgentTeamKeys.list(),
    queryFn: loadTeams,
    staleTime: 30 * 1000,
  });

  return {
    teams: data ?? [],
    loading: isFetching,
    error: error ? error.message : undefined,
    refetch,
  };
};
