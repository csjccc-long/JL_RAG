import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import {
  IAgentTeamForm,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';
import { TaskList } from './task-list';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('./task-card', () => ({
  TaskCard: ({ index }: { index: number }) => <span>task-card-{index}</span>,
}));

jest.mock('./use-team-form', () => ({
  useAgentTeamDefaults: () => ({
    createTask: (worker: string): IAgentTeamTask => ({
      worker,
      task: 'New task',
      context: '',
      expected_output: '',
    }),
  }),
}));

function makeWorker(id: string): IAgentTeamWorker {
  return {
    id,
    name: id,
    role: '',
    capabilities: [],
    description: '',
    agent: { params: { llm_id: 'test-model' } },
  };
}

function makeTask(worker: string, task: string): IAgentTeamTask {
  return {
    worker,
    task,
    context: '',
    expected_output: '',
  };
}

function makeValues(overrides: Partial<IAgentTeamForm> = {}): IAgentTeamForm {
  return {
    process: 'sequential',
    manager: {},
    workers: [makeWorker('writer'), makeWorker('reviewer')],
    tasks: [
      makeTask('writer', 'Draft'),
      makeTask('reviewer', 'Review'),
    ],
    max_concurrency: 4,
    collaboration_rounds: 3,
    judge: '',
    max_delegations: 8,
    max_depth: 3,
    worker_timeout: 300,
    custom_header: {},
    outputs: {},
    ...overrides,
  };
}

function Harness({ values }: { values: IAgentTeamForm }) {
  const form = useForm<IAgentTeamForm>({ defaultValues: values });
  const tasks = useWatch({ control: form.control, name: 'tasks' });

  return (
    <FormProvider {...form}>
      <TaskList />
      <output data-testid="tasks">{JSON.stringify(tasks)}</output>
    </FormProvider>
  );
}

function currentTasks() {
  return JSON.parse(screen.getByTestId('tasks').textContent ?? '[]');
}

describe('TaskList', () => {
  it('moves tasks in execution order and deletes the selected task', async () => {
    render(<Harness values={makeValues()} />);

    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'flow.agentTeam.moveDown',
      })[0],
    );

    await waitFor(() => {
      expect(currentTasks().map((task: IAgentTeamTask) => task.task)).toEqual([
        'Review',
        'Draft',
      ]);
    });

    fireEvent.click(
      screen.getAllByRole('button', { name: 'common.delete' })[1],
    );

    await waitFor(() => {
      expect(currentTasks()).toEqual([
        expect.objectContaining({ worker: 'reviewer', task: 'Review' }),
      ]);
    });
  });

  it('appends a task and assigns the first worker by default', async () => {
    render(<Harness values={makeValues()} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'flow.agentTeam.addTask' }),
    );

    await waitFor(() => {
      expect(currentTasks()).toHaveLength(3);
    });
    expect(currentTasks()[2]).toEqual(
      expect.objectContaining({ worker: 'writer', task: 'New task' }),
    );
  });

  it('shows the vote contract hint for vote strategies', () => {
    render(<Harness values={makeValues({ process: 'vote' })} />);

    expect(
      screen.getByText('flow.agentTeam.voteContractHint'),
    ).toBeInTheDocument();
  });
});
