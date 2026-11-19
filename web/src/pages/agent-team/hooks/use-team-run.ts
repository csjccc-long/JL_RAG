import { useCallback, useEffect, useState } from 'react';
import {
  IMessageData,
  INodeData,
  MessageEventType,
  useSendMessageBySSE,
} from '@/hooks/use-send-message';
import { createAgentSession } from '@/services/agent-service';
import api from '@/utils/api';
import { AGENT_TEAM_COMPONENT_NAME } from '../utils/extract-teams';

export interface ITeamRunSnapshot {
  componentId: string;
  outputs: Record<string, any>;
  error: string;
  elapsedMs: number;
}

// 画布节点名是 DSL 里的 key（如 "AgentTeam:HierarchicalTeam"），
// 直接比对 === 'AgentTeam' 永远不成立，导致右栏拿不到 structured/delegations，
// 部分成功、未覆盖成员告警、judge/votes 都不会显示。
export const isAgentTeamNodeName = (name: unknown): boolean =>
  typeof name === 'string' && name.split(':')[0] === AGENT_TEAM_COMPONENT_NAME;

export const pickTeamSnapshot = (events: any[]): ITeamRunSnapshot | undefined => {
  let snapshot: ITeamRunSnapshot | undefined;
  events.forEach((item) => {
    if (item?.event !== MessageEventType.NodeFinished) return;
    const node = item.data as INodeData;
    if (!isAgentTeamNodeName(node?.component_name)) return;
    const outputs = node.outputs ?? {};
    snapshot = {
      componentId: node.component_id,
      outputs,
      error: node.error || String(outputs._ERROR ?? ''),
      elapsedMs: Number(node.elapsed_time ?? 0) * 1000,
    };
  });
  return snapshot;
};

const pickAnswer = (events: any[]): string => {
  let content = '';
  events.forEach((item) => {
    if (item?.event !== MessageEventType.Message) return;
    const data = item.data as IMessageData;
    if (typeof data?.content === 'string' && data.content) {
      content = data.content;
    }
  });
  return content;
};

const pickError = (events: any[]): string => {
  let error = '';
  events.forEach((item) => {
    const data = item?.data;
    if (!data || typeof data !== 'object') return;
    if (typeof data.error === 'string' && data.error) {
      error = data.error;
    }
    const nested = data.outputs?._ERROR;
    if (typeof nested === 'string' && nested) {
      error = nested;
    }
  });
  return error;
};

// 独立页运行一个团队：直接 POST /v1/agents/chat/completions（SSE），
// session_id 就是后端画布的 task_id，也是进度通道的 key。
export const useTeamRun = () => {
  const [taskId, setTaskId] = useState<string>();
  const [query, setQuery] = useState('');
  const [snapshot, setSnapshot] = useState<ITeamRunSnapshot>();
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const { send, answerList, done, stopOutputMessage, resetAnswerList } =
    useSendMessageBySSE(api.agentChatCompletion);

  useEffect(() => {
    if (!answerList.length) return;
    const nextSnapshot = pickTeamSnapshot(answerList);
    if (nextSnapshot) {
      setSnapshot(nextSnapshot);
    }
    const nextAnswer = pickAnswer(answerList);
    if (nextAnswer) {
      setAnswer(nextAnswer);
    }
    const nextError = pickError(answerList);
    if (nextError) {
      setError(nextError);
    }
  }, [answerList]);

  const run = useCallback(
    async (agentId: string, teamQuery: string, inputs: Record<string, any> = {}) => {
      setQuery(teamQuery);
      setSnapshot(undefined);
      setAnswer('');
      setError('');
      resetAnswerList();

      // 后端只接受已存在的会话（否则返回 "Session not found!"），而会话 ID 同时
      // 是画布的 task_id，也就是进度通道的 key，所以必须先建会话再发消息。
      let sessionId = '';
      try {
        const created = await createAgentSession({
          id: agentId,
          name: teamQuery.slice(0, 80) || 'Agent team run',
        });
        sessionId = created?.data?.data?.id ?? '';
        if (!sessionId) {
          setError(created?.data?.message ?? 'Failed to create session');
          return undefined;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create session');
        return undefined;
      }
      setTaskId(sessionId);

      const res = await send({
        agent_id: agentId,
        stream: true,
        query: teamQuery,
        inputs,
        files: [],
        session_id: sessionId,
        running_hint_text: 'is running...🕞',
        'openai-compatible': false,
      });

      if (res && res.response && res.response.status !== 200) {
        setError(String(res.data?.message ?? 'Request failed'));
      }
      return res;
    },
    [send, resetAnswerList],
  );

  const stop = useCallback(() => {
    stopOutputMessage();
  }, [stopOutputMessage]);

  return {
    run,
    stop,
    running: !done,
    taskId,
    query,
    snapshot,
    answer,
    error,
  };
};
