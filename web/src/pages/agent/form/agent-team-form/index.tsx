import { Form } from '@/components/ui/form';
import {
  IAgentTeamForm,
  IAgentTeamNode,
} from '@/interfaces/database/agent';
import { TFunction } from 'i18next';
import { get, set } from 'lodash';
import { memo, useMemo } from 'react';
import {
  FieldErrors,
  Resolver,
  useForm,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { INextOperatorForm } from '../../interface';
import { FormWrapper } from '../components/form-wrapper';
import { JudgeField } from './judge-field';
import { ManagerField } from './manager-field';
import { ProcessSelector } from './process-selector';
import { RunGuardrails } from './run-guardrails';
import { TaskList } from './task-list';
import { TeamOutput } from './team-output';
import {
  useAgentTeamValues,
  useAgentTeamWatchFormChange,
} from './use-team-form';
import {
  AgentTeamValidationIssue,
} from './interface';
import {
  sanitizeAgentTeamValues,
  validateAgentTeam,
} from './validation';
import { WorkerList } from './worker-list';

function buildFieldErrors(
  issues: AgentTeamValidationIssue[],
  t: TFunction,
): FieldErrors<IAgentTeamForm> {
  const errors: FieldErrors<IAgentTeamForm> = {};

  issues.forEach((issue) => {
    if (get(errors, issue.path)) {
      return;
    }
    set(errors, issue.path, {
      type: 'validate',
      message: t(issue.messageKey, issue.values),
    });
  });

  return errors;
}

function createAgentTeamResolver(t: TFunction): Resolver<IAgentTeamForm> {
  return async (values) => {
    const sanitized = sanitizeAgentTeamValues(values);
    const errors = buildFieldErrors(validateAgentTeam(sanitized), t);
    return {
      values: Object.keys(errors).length > 0 ? {} : values,
      errors,
    };
  };
}

function AgentTeamForm({ node }: INextOperatorForm) {
  const { t } = useTranslation();
  const defaultValues = useAgentTeamValues(
    node as IAgentTeamNode | undefined,
  );
  const resolver = useMemo(() => createAgentTeamResolver(t), [t]);
  const form = useForm<IAgentTeamForm>({
    defaultValues,
    resolver,
    mode: 'onChange',
  });
  const process = form.watch('process');

  useAgentTeamWatchFormChange(node?.id, form);

  return (
    <Form {...form}>
      <FormWrapper>
        <ProcessSelector />
        {process === 'hierarchical' ? <ManagerField /> : <TaskList />}
        <WorkerList />
        {process === 'vote' ||
        process === 'debate' ||
        process === 'consensus' ? (
          <JudgeField />
        ) : null}
        <RunGuardrails />
        <TeamOutput />
      </FormWrapper>
    </Form>
  );
}

export default memo(AgentTeamForm);
