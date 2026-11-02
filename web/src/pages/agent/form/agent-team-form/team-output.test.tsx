import { fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useForm, useFormContext } from 'react-hook-form';
import { IAgentTeamForm } from '@/interfaces/database/agent';
import { CustomHeaderInput } from './team-output';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function ErrorProbe() {
  const form = useFormContext<IAgentTeamForm>();
  const error = form.formState.errors.custom_header?.message;
  return (
    <span data-testid="header-error">
      {typeof error === 'string' ? error : ''}
    </span>
  );
}

function Harness({ onChange }: { onChange(value: object): void }) {
  const form = useForm<IAgentTeamForm>({
    defaultValues: {
      custom_header: { 'X-Team-Trace': 'enabled' },
    } as unknown as IAgentTeamForm,
  });
  return (
    <FormProvider {...form}>
      <CustomHeaderInput
        value={form.getValues('custom_header')}
        onChange={onChange}
      />
      <ErrorProbe />
    </FormProvider>
  );
}

describe('CustomHeaderInput', () => {
  it('sets an error without replacing the existing header on invalid JSON', () => {
    const onChange = jest.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{not-json' },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('header-error')).toHaveTextContent(
      'flow.agentTeam.validation.customHeaderJson',
    );
  });
});
