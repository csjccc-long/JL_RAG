import { shouldSkipAgentAutosave } from '../autosave-guard';

describe('shouldSkipAgentAutosave', () => {
  const storedTeam = {
    graph: { nodes: [], edges: [] },
    components: {
      begin: { obj: { component_name: 'Begin', params: {} } },
      'AgentTeam:Desk': { obj: { component_name: 'AgentTeam', params: {} } },
    },
  } as any;

  it('skips while the run drawer is open', () => {
    expect(
      shouldSkipAgentAutosave({
        chatDrawerVisible: true,
        detailLoaded: true,
        nodeCount: 3,
        storedDsl: null,
      }),
    ).toBe(true);
  });

  it('skips until the agent detail has loaded', () => {
    expect(
      shouldSkipAgentAutosave({
        chatDrawerVisible: false,
        detailLoaded: false,
        nodeCount: 0,
        storedDsl: storedTeam,
      }),
    ).toBe(true);
  });

  it('refuses to overwrite a stored definition with an empty canvas', () => {
    expect(
      shouldSkipAgentAutosave({
        chatDrawerVisible: false,
        detailLoaded: true,
        nodeCount: 0,
        storedDsl: storedTeam,
      }),
    ).toBe(true);
  });

  it('saves an intentionally cleared canvas (stored definition is empty too)', () => {
    expect(
      shouldSkipAgentAutosave({
        chatDrawerVisible: false,
        detailLoaded: true,
        nodeCount: 0,
        storedDsl: { graph: { nodes: [], edges: [] }, components: {} } as any,
      }),
    ).toBe(false);
  });

  it('saves normal edits', () => {
    expect(
      shouldSkipAgentAutosave({
        chatDrawerVisible: false,
        detailLoaded: true,
        nodeCount: 2,
        storedDsl: storedTeam,
      }),
    ).toBe(false);
  });
});
