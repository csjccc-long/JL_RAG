import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IAgentTeamWorker, IFlow } from '@/interfaces/database/agent';
import agentService, { updateAgent } from '@/services/agent-service';
import { applyTeamWorkers } from '../utils/apply-workers';
import { IAgentTeamSummary } from '../utils/extract-teams';
import { workerFromAgent } from '../utils/worker-from-agent';
import { AgentTeamKeys } from './use-agent-teams';

const asFlow = (payload: unknown): IFlow | undefined =>
  (payload as { data?: IFlow } | undefined)?.data;

export interface AssignWorkersInput {
  team: IAgentTeamSummary;
  /** the agents that are on the team, in the order they were picked */
  workerIds: string[];
}

export const useAssignWorkers = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ team, workerIds }: AssignWorkersInput) => {
      const known = new Map(team.workers.map((worker) => [worker.id, worker]));
      const workers: IAgentTeamWorker[] = [];

      for (const id of workerIds) {
        const existing = known.get(id);
        workers.push(existing ?? (await workerFromAgent(id)));
      }

      const { data } = await agentService.getAgent(team.agentId);
      const dsl = asFlow(data)?.dsl;
      if (!dsl) throw new Error('the team canvas could not be read');

      await updateAgent(team.agentId, {
        dsl: applyTeamWorkers(dsl, team.componentId, workers),
      });
      return workers;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AgentTeamKeys.list() });
    },
  });
};
