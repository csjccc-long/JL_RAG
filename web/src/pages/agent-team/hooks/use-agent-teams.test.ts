const mockListAgents = jest.fn();
const mockGetAgent = jest.fn();
const mockExtractTeamNodes = jest.fn();

jest.mock('@/services/agent-service', () => ({
  __esModule: true,
  default: {
    listAgents: (...args: unknown[]) => mockListAgents(...args),
    getAgent: (...args: unknown[]) => mockGetAgent(...args),
  },
}));

jest.mock('../utils/extract-teams', () => ({
  extractTeamNodes: (...args: unknown[]) => mockExtractTeamNodes(...args),
}));

import {
  AGENT_TEAM_PAGE_SIZE,
  listAllAgentCanvases,
  loadTeams,
} from './use-agent-teams';

const buildAgents = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
  }));

describe('listAllAgentCanvases', () => {
  beforeEach(() => {
    mockListAgents.mockReset();
    mockGetAgent.mockReset();
    mockExtractTeamNodes.mockReset();
  });

  it('never asks for more than the backend page_size ceiling', async () => {
    mockListAgents.mockResolvedValue({
      data: { data: { canvas: buildAgents(2, 'a'), total: 2 } },
    });

    await listAllAgentCanvases();

    expect(mockListAgents).toHaveBeenCalledTimes(1);
    expect(mockListAgents.mock.calls[0][0].params.page_size).toBe(
      AGENT_TEAM_PAGE_SIZE,
    );
    expect(AGENT_TEAM_PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it('walks every page until a short page arrives', async () => {
    mockListAgents
      .mockResolvedValueOnce({
        data: {
          data: { canvas: buildAgents(AGENT_TEAM_PAGE_SIZE, 'full'), total: 101 },
        },
      })
      .mockResolvedValueOnce({
        data: { data: { canvas: buildAgents(1, 'tail'), total: 101 } },
      });

    const canvases = await listAllAgentCanvases();

    expect(mockListAgents).toHaveBeenCalledTimes(2);
    expect(mockListAgents.mock.calls[1][0].params.page).toBe(2);
    expect(canvases).toHaveLength(AGENT_TEAM_PAGE_SIZE + 1);
  });

  it('stops once the reported total is reached', async () => {
    mockListAgents.mockResolvedValue({
      data: {
        data: { canvas: buildAgents(AGENT_TEAM_PAGE_SIZE, 'full'), total: 100 },
      },
    });

    await listAllAgentCanvases();

    expect(mockListAgents).toHaveBeenCalledTimes(1);
  });
});

describe('loadTeams', () => {
  beforeEach(() => {
    mockListAgents.mockReset();
    mockGetAgent.mockReset();
    mockExtractTeamNodes.mockReset();
  });

  it('keeps one summary per team node and labels it with the canvas title', async () => {
    mockListAgents.mockResolvedValue({
      data: { data: { canvas: buildAgents(1, 'canvas'), total: 1 } },
    });
    mockGetAgent.mockResolvedValue({ data: { data: { dsl: { components: [] } } } });
    mockExtractTeamNodes.mockReturnValue([
      { componentId: 'AgentTeam:1', process: 'parallel' },
    ]);

    const teams = await loadTeams();

    expect(mockGetAgent).toHaveBeenCalledWith('canvas-0');
    expect(teams).toEqual([
      expect.objectContaining({
        agentId: 'canvas-0',
        agentTitle: 'canvas 0',
        componentId: 'AgentTeam:1',
      }),
    ]);
  });

  it('keeps loading other canvases when one detail request fails', async () => {
    mockListAgents.mockResolvedValue({
      data: { data: { canvas: buildAgents(2, 'canvas'), total: 2 } },
    });
    mockGetAgent
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ data: { data: { dsl: {} } } });
    mockExtractTeamNodes.mockReturnValue([]);

    await expect(loadTeams()).resolves.toEqual([]);
    expect(mockGetAgent).toHaveBeenCalledTimes(2);
  });
});
