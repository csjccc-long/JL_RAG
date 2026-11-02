import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import {
  IAgentTeamForm,
  IAgentTeamTask,
  IAgentTeamWorker,
} from '@/interfaces/database/agent';
import { WorkerList } from './worker-list';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('./worker-card', () => ({
  WorkerCard: ({
    index,
    referenced,
    onDelete,
  }: {
    index: number;
    referenced: boolean;
    onDelete(index: number): void;
  }) => (
    <button
      type="button"
      onClick={() => onDelete(index)}
      aria-label={`delete-${index}`}
      data-referenced={referenced}
    >
      {index}
    </button>
  ),
}));

jest.mock('./use-team-form', () => ({
  useAgentTeamDefaults: () => ({
    createWorker: (workers: IAgentTeamWorker[]): IAgentTeamWorker => ({
      id: `worker_${workers.length + 1}`,
      name: `Worker ${workers.length + 1}`,
      role: '',
      capabilities: [],
      description: '',
      agent: { params: { llm_id: 'test-model' } },
    }),
  }),
}));

function makeWorker(id: string, name = id): IAgentTeamWorker {
  return {
    id,
    name,
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
    workers: [makeWorker('writer', 'Draft Writer'), makeWorker('reviewer')],
    tasks: [
      makeTask('draft writer', 'Draft'),
      makeTask('reviewer', 'Review'),
    ],
    max_concurrency: 4,
    collaboration_rounds: 3,
    judge: ' DRAFT WRITER ',
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
  const workers = useWatch({ control: form.control, name: 'workers' });
  const tasks = useWatch({ control: form.control, name: 'tasks' });
  const judge = useWatch({ control: form.control, name: 'judge' });

  return (
    <FormProvider {...form}>
      <WorkerList />
      <output data-testid="form-state">
        {JSON.stringify({ workers, tasks, judge })}
      </output>
    </FormProvider>
  );
}

function formState() {
  return JSON.parse(screen.getByTestId('form-state').textContent ?? '{}');
}

describe('WorkerList', () => {
  it('removes the worker and clears every task and judge reference', async () => {
    render(<Harness values={makeValues()} />);

    const deleteButtons = screen.getAllByRole('button', {
      name: /delete-/,
    });
    expect(deleteButtons[0]).toHaveAttribute('data-referenced', 'true');
    expect(deleteButtons[1]).toHaveAttribute('data-referenced', 'true');

    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(formState().workers).toEqual([
        expect.objectContaining({ id: 'reviewer' }),
      ]);
    });
    expect(formState().tasks).toEqual([
      expect.objectContaining({ worker: 'reviewer' }),
    ]);
    expect(formState().judge).toBe('');
  });

  it('appends a worker with a non-conflicting generated id', async () => {
    render(
      <Harness
        values={makeValues({
          workers: [makeWorker('worker_1')],
          tasks: [makeTask('worker_1', 'Draft')],
          judge: '',
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'flow.agentTeam.addWorker' }),
    );

    await waitFor(() => {
      expect(formState().workers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'worker_1' }),
          expect.objectContaining({ id: 'worker_2' }),
        ]),
      );
    });
    expect(formState().workers).toHaveLength(2);
  });
});
