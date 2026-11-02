import { useTranslation } from 'react-i18next';
import { AgentConfigFields } from './agent-config-fields';

export function ManagerField() {
  const { t } = useTranslation();

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t('flow.agentTeam.manager')}</h3>
        <p className="mt-1 text-xs text-text-secondary">
          {t('flow.agentTeam.managerDescription')}
        </p>
      </div>
      <AgentConfigFields prefix="manager.params" maxRounds={20} />
    </section>
  );
}
