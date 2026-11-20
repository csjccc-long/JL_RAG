import { IAgentTeamWorker, IFlow } from '@/interfaces/database/agent';
import agentService from '@/services/agent-service';
import { extractAgentParams } from './agent-brain';

const asFlow = (payload: unknown): IFlow | undefined =>
  (payload as { data?: IFlow } | undefined)?.data;

/* ── a chosen agent becomes a worker ──────────────────────
   The worker is not authored here: its prompt, model and tools are lifted off
   the agent that was picked, and the id it came from is kept on the worker so
   the board can say which agent is speaking. */
export const workerFromAgent = async (
  agentId: string,
): Promise<IAgentTeamWorker> => {
  const { data } = await agentService.getAgent(agentId);
  const agent = asFlow(data);
  const params = extractAgentParams(agent?.dsl);
  if (!params) {
    throw new Error(
      `agent ${agent?.title || agentId} has no model step to run as a worker`,
    );
  }
  return {
    id: agentId,
    name: agent?.title || agentId,
    role: '',
    agent_id: agentId,
    agent: { params },
  };
};
