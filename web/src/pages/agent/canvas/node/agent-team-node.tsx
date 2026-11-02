import { Badge } from '@/components/ui/badge';
import { BaseNode, IAgentTeamForm } from '@/interfaces/database/agent';
import { NodeProps, Position } from '@xyflow/react';
import { get } from 'lodash';
import { memo, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentInstanceContext } from '../../context';
import { NodeHandleId } from '../../constant';
import { CommonHandle, LeftEndHandle } from './handle';
import { RightHandleStyle } from './handle-icon';
import NodeHeader from './node-header';
import { NodeWrapper } from './node-wrapper';
import { ToolBar } from './toolbar';

type TeamStatus = 'notRun' | 'running' | 'success' | 'partial' | 'failed';

function getStatus(
  outputs: Record<string, any> | undefined,
  error: string | null | undefined,
): TeamStatus {
  if (error || outputs?._ERROR) {
    const delegations = Array.isArray(outputs?.delegations)
      ? outputs.delegations
      : [];
    const hasSuccess = delegations.some((item: any) => item?.status === 'ok');
    return hasSuccess ? 'partial' : 'failed';
  }

  if (outputs) {
    const structured =
      typeof outputs.structured === 'string'
        ? (() => {
            try {
              return JSON.parse(outputs.structured);
            } catch {
              return {};
            }
          })()
        : outputs.structured;
    if (structured?.status === 'partial') {
      return 'partial';
    }
    return 'success';
  }

  return 'notRun';
}

function InnerAgentTeamNode({
  id,
  data,
  isConnectable = true,
  selected,
}: NodeProps<BaseNode<IAgentTeamForm>>) {
  const { t } = useTranslation();
  const {
    currentSendLoading,
    startButNotFinishedNodeIds = [],
    lastFinishedNodeMap = {},
  } = useContext(AgentInstanceContext);
  const form = data.form;
  const isRunning = Boolean(
    currentSendLoading && startButNotFinishedNodeIds.includes(id),
  );
  const finishedNode =
    lastFinishedNodeMap[id];
  const status: TeamStatus = isRunning
    ? 'running'
    : getStatus(finishedNode?.outputs, finishedNode?.error);
  const process = form?.process ?? 'hierarchical';
  const workerCount = form?.workers?.length ?? 0;
  const taskCount = form?.tasks?.length ?? 0;
  const managerModel = get(form, 'manager.params.llm_id');
  const hasJudge = Boolean(form?.judge?.trim());

  const badgeVariant = useMemo(() => {
    if (status === 'success') return 'success';
    if (status === 'failed') return 'destructive';
    if (status === 'running') return 'default';
    return 'secondary';
  }, [status]);

  return (
    <ToolBar selected={selected} id={id} label={data.label}>
      <NodeWrapper selected={selected} id={id}>
        <LeftEndHandle />
        <CommonHandle
          type="source"
          position={Position.Right}
          isConnectable={isConnectable}
          style={RightHandleStyle}
          nodeId={id}
          id={NodeHandleId.Start}
          isConnectableEnd={false}
        />
        <NodeHeader id={id} name={data.name} label={data.label} />
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">
              {t(`flow.agentTeam.process.${process}.label`)}
            </span>
            <Badge variant={badgeVariant} className="shrink-0 px-1.5 py-0">
              {t(`flow.agentTeam.status.${status}`)}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-1 text-text-secondary">
            <span>
              {t('flow.agentTeam.workerCount', { count: workerCount })}
            </span>
            <span className="truncate text-right">
              {process === 'hierarchical'
                ? t('flow.agentTeam.managerStatus', {
                    value: managerModel ?? t('flow.agentTeam.notConfigured'),
                  })
                : t('flow.agentTeam.taskCount', { count: taskCount })}
            </span>
          </div>
          {hasJudge && (
            <div className="flex items-center justify-between gap-2 text-text-secondary">
              <span>{t('flow.agentTeam.judge')}</span>
              <Badge
                variant="outline"
                className="max-w-[110px] truncate px-1.5 py-0"
              >
                {form?.judge}
              </Badge>
            </div>
          )}
        </section>
      </NodeWrapper>
    </ToolBar>
  );
}

export const AgentTeamNode = memo(InnerAgentTeamNode);
