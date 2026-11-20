import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentCategory } from '@/constants/agent';
import { AgentTeamProcess, IAgentTeamWorker } from '@/interfaces/database/agent';
import agentService from '@/services/agent-service';
import { ProcessSeedText } from '../utils/apply-process';
import { buildTeamDsl, teamNodeName } from '../utils/build-team-dsl';
import { workerFromAgent } from '../utils/worker-from-agent';
import { AgentTeamKeys } from './use-agent-teams';

export interface CreateTeamInput {
  title: string;
  process: AgentTeamProcess;
  /** the agents that become this team's members, in the order they were picked */
  workerIds: string[];
  seed: ProcessSeedText;
  prologue?: string;
}

export const useCreateTeam = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTeamInput): Promise<string> => {
      const workers: IAgentTeamWorker[] = [];
      for (const id of input.workerIds) {
        workers.push(await workerFromAgent(id));
      }

      const dsl = buildTeamDsl({
        title: input.title,
        nodeName: teamNodeName(input.title),
        process: input.process,
        workers,
        seed: input.seed,
        prologue: input.prologue,
      });

      const { data } = await agentService.createAgent({
        title: input.title,
        dsl,
        canvas_category: AgentCategory.AgentCanvas,
      } as never);

      if (data?.code !== 0 || !data?.data?.id) {
        throw new Error(data?.message || 'the team could not be created');
      }
      return String(data.data.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AgentTeamKeys.list() });
    },
  });
};
