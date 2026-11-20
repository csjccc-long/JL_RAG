import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AgentTeamProcess, IFlow } from '@/interfaces/database/agent';
import agentService, { updateAgent } from '@/services/agent-service';
import { applyTeamProcess, ProcessSeedText } from '../utils/apply-process';
import { IAgentTeamSummary } from '../utils/extract-teams';
import { AgentTeamKeys } from './use-agent-teams';

const asFlow = (payload: unknown): IFlow | undefined =>
  (payload as { data?: IFlow } | undefined)?.data;

export interface SetProcessInput {
  team: IAgentTeamSummary;
  process: AgentTeamProcess;
  /** wording for the tasks and the manager a switch has to create */
  seed?: Partial<ProcessSeedText>;
}

/* ── the collaboration mode is a property of the team, not of the run ──
   It is written back into the team's own canvas, so the board and the canvas
   keep reading one definition — the same rule the crew picker follows. */
export const useSetProcess = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ team, process, seed }: SetProcessInput) => {
      const { data } = await agentService.getAgent(team.agentId);
      const dsl = asFlow(data)?.dsl;
      if (!dsl) throw new Error('the team canvas could not be read');

      await updateAgent(team.agentId, {
        dsl: applyTeamProcess(dsl, team.componentId, process, {
          teamName: team.agentTitle,
          seed,
        }),
      });

      return process;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AgentTeamKeys.list() });
    },
  });
};
