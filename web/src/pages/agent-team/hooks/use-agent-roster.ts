import { useQuery } from '@tanstack/react-query';
import { AgentListItem, AgentListItemType, IFlow } from '@/interfaces/database/agent';
import { listAllAgentCanvases } from './use-agent-teams';

export const AgentRosterKeys = {
  list: () => ['agent-team', 'roster'] as const,
};

/**
 * The agents that already exist — the pool a collaboration is assembled from.
 *
 * Template groups come back in the same list and are not agents, so they are
 * dropped here rather than at every call site. The list payload carries no dsl,
 * so whether an agent can lend a brain is only known when it is picked — that
 * check lives in useAssignWorkers, where the full canvas is already fetched.
 */
const isAgent = (item: AgentListItem): item is IFlow =>
  item.type !== AgentListItemType.CompilationTemplateGroup;

export const useAgentRoster = () => {
  const { data, isFetching } = useQuery({
    queryKey: AgentRosterKeys.list(),
    queryFn: listAllAgentCanvases,
    staleTime: 30 * 1000,
  });

  return {
    roster: (data ?? []).filter(isAgent),
    loading: isFetching,
  };
};
