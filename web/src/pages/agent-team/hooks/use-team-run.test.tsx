import { act, renderHook } from '@testing-library/react';

const mockSend = jest.fn();
const mockCreateAgentSession = jest.fn();

jest.mock('@/services/agent-service', () => ({
  createAgentSession: (payload: { id: string; name: string }) =>
    mockCreateAgentSession(payload),
}));

jest.mock('@/hooks/use-send-message', () => ({
  useSendMessageBySSE: () => ({
    send: mockSend,
    answerList: [],
    done: true,
    setDone: jest.fn(),
    resetAnswerList: jest.fn(),
    stopOutputMessage: jest.fn(),
  }),
  MessageEventType: {
    NodeFinished: 'node_finished',
    Message: 'message',
  },
}));

import { pickTeamSnapshot, useTeamRun } from './use-team-run';

describe('useTeamRun', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCreateAgentSession.mockReset();
    mockSend.mockResolvedValue({ response: { status: 200 }, data: {} });
  });

  it('creates a session before sending and reuses its id as task id', async () => {
    mockCreateAgentSession.mockResolvedValue({
      data: { code: 0, data: { id: 'session-1' } },
    });

    const { result } = renderHook(() => useTeamRun());
    await act(async () => {
      await result.current.run('agent-1', '调研供应链风险');
    });

    expect(mockCreateAgentSession).toHaveBeenCalledWith({
      id: 'agent-1',
      name: '调研供应链风险',
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'agent-1', session_id: 'session-1' }),
    );
    expect(result.current.taskId).toBe('session-1');
  });

  it('reports an error and never sends when the session cannot be created', async () => {
    mockCreateAgentSession.mockResolvedValue({
      data: { code: 100, message: 'Session not found!' },
    });

    const { result } = renderHook(() => useTeamRun());
    await act(async () => {
      await result.current.run('agent-1', '调研供应链风险');
    });

    expect(mockSend).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Session not found!');
  });
});

describe('pickTeamSnapshot', () => {
  const nodeFinished = (componentName: string, outputs: Record<string, any>) => ({
    event: 'node_finished',
    data: {
      component_name: componentName,
      component_id: componentName,
      outputs,
      error: '',
      elapsed_time: 1.5,
    },
  });

  it('matches a DSL node key such as "AgentTeam:HierarchicalTeam"', () => {
    const snapshot = pickTeamSnapshot([
      nodeFinished('Begin', { query: 'hi' }),
      nodeFinished('AgentTeam:HierarchicalTeam', {
        content: 'team answer',
        structured: { status: 'partial', warning: 'not delegated: beta' },
      }),
    ]);

    expect(snapshot?.outputs.structured).toEqual({
      status: 'partial',
      warning: 'not delegated: beta',
    });
    expect(snapshot?.elapsedMs).toBe(1500);
  });

  it('ignores nodes that are not part of a team', () => {
    expect(pickTeamSnapshot([nodeFinished('Generate:LLM', { content: 'x' })])).toBeUndefined();
  });
});
