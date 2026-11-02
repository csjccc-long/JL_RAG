import { fireEvent, render, screen } from '@testing-library/react';
import { Form } from '@/components/ui/form';
import { useForm, useWatch } from 'react-hook-form';
import { ProcessSelector } from './process-selector';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'flow.agentTeam.process.hierarchical.label': 'Hierarchical',
        'flow.agentTeam.process.hierarchical.description':
          'Manager strategy',
        'flow.agentTeam.process.parallel.label': 'Parallel',
        'flow.agentTeam.process.parallel.description': 'Parallel strategy',
        'flow.agentTeam.process.sequential.label': 'Sequential',
        'flow.agentTeam.process.sequential.description': 'Sequential strategy',
        'flow.agentTeam.process.vote.label': 'Vote',
        'flow.agentTeam.process.vote.description': 'Vote strategy',
        'flow.agentTeam.process.debate.label': 'Debate',
        'flow.agentTeam.process.debate.description': 'Debate strategy',
        'flow.agentTeam.process.consensus.label': 'Consensus',
        'flow.agentTeam.process.consensus.description': 'Consensus strategy',
      };
      return labels[key] ?? key;
    },
  }),
}));

function ProcessSelectorHarness() {
  const form = useForm({ defaultValues: { process: 'hierarchical' } });
  const process = useWatch({ control: form.control, name: 'process' });

  return (
    <Form {...form}>
      <ProcessSelector />
      <div>{process === 'hierarchical' ? 'Manager' : 'Tasks'}</div>
    </Form>
  );
}

describe('ProcessSelector', () => {
  it('shows Manager only for hierarchical and Tasks for other strategies', () => {
    render(<ProcessSelectorHarness />);

    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.queryByText('Tasks')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Parallel/ }));

    expect(screen.queryByText('Manager')).not.toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
  });
});
