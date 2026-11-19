import {
  useFetchAgent,
  useResetAgent,
  useSetAgent,
} from '@/hooks/use-agent-request';
import {
  GlobalVariableType,
  RAGFlowNodeType,
} from '@/interfaces/database/agent';
import { formatDate } from '@/utils/date';
import { useDebounceEffect } from 'ahooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import useGraphStore from '../store';
import { shouldSkipAgentAutosave } from '../utils/autosave-guard';
import { useBuildDslData } from './use-build-dsl';

export const useSaveGraph = (
  showMessage: boolean = true,
  skipInvalidation: boolean = false,
) => {
  const { data } = useFetchAgent();
  const { setAgent, loading } = useSetAgent(showMessage, skipInvalidation);
  const { id } = useParams();
  const { buildDslData } = useBuildDslData();

  const saveGraph = useCallback(
    async (
      currentNodes?: RAGFlowNodeType[],
      otherParam?: {
        globalVariables: Record<string, GlobalVariableType>;
      },
      release?: boolean,
    ) => {
      const params: Record<string, any> = {
        id,
        title: data.title,
        dsl: buildDslData(currentNodes, otherParam),
      };

      if (release) {
        params.release = 'true';
      }

      return setAgent(params);
    },
    [setAgent, data, id, buildDslData],
  );

  return { saveGraph, loading };
};

export const useSaveGraphBeforeOpeningDebugDrawer = (show: () => void) => {
  const { saveGraph, loading } = useSaveGraph();
  const { resetAgent } = useResetAgent();

  const handleRun = useCallback(
    async (nextNodes?: RAGFlowNodeType[]) => {
      const saveRet = await saveGraph(nextNodes);
      if (saveRet?.code === 0) {
        // Call the reset api before opening the run drawer each time
        const resetRet = await resetAgent();
        // After resetting, all previous messages will be cleared.
        if (resetRet?.code === 0) {
          show();
        }
      }
    },
    [saveGraph, resetAgent, show],
  );

  return { handleRun, loading };
};

export const useWatchAgentChange = (chatDrawerVisible: boolean) => {
  const [time, setTime] = useState<string>();
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const { saveGraph } = useSaveGraph(false, true);
  const { data: flowDetail } = useFetchAgent();

  const setSaveTime = useCallback((updateTime: number) => {
    setTime(formatDate(updateTime));
  }, []);

  useEffect(() => {
    setSaveTime(flowDetail?.update_time);
  }, [flowDetail, setSaveTime]);

  // The detail request must resolve before the first save; otherwise
  // the empty initial store is written back over the stored DSL.
  const detailLoadedRef = useRef(false);
  useEffect(() => {
    if (flowDetail?.id) {
      detailLoadedRef.current = true;
    }
  }, [flowDetail?.id]);

  const saveAgent = useCallback(async () => {
    if (
      shouldSkipAgentAutosave({
        chatDrawerVisible,
        detailLoaded: detailLoadedRef.current,
        nodeCount: nodes.length,
        storedDsl: flowDetail?.dsl,
      })
    ) {
      return;
    }
    const ret = await saveGraph();
    setSaveTime(ret.data.update_time ?? Date.now());
  }, [chatDrawerVisible, saveGraph, setSaveTime, nodes.length, flowDetail?.dsl]);

  useDebounceEffect(
    () => {
      saveAgent();
    },
    [nodes, edges],
    {
      wait: 1000 * 20,
    },
  );

  return time;
};
