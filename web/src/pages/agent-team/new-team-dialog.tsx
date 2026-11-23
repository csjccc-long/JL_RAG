import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AgentTeamProcess, IFlow } from '@/interfaces/database/agent';
import { AGENT_TEAM_PROCESSES } from '@/pages/agent/form/agent-team-form/interface';
import { managerBrief, seedExpectedText, seedTaskText } from './utils/apply-process';
import { AgentAvatar } from './result-dial';
import { useCreateTeam } from './hooks/use-create-team';
import { PROCESS_ICONS } from './process-menu';
import './new-team-dialog.css';

/**
 * Standing up a team, from the agents that already exist.
 *
 * Nothing is authored from scratch here: a team is a shape around agents that
 * already have a prompt and a model. What is chosen is who is on it and how they
 * work together — the tasks, the judge and the manager are laid out by the
 * process, exactly as switching the process later would.
 */

const NAME_BASE = 'newTeamDefaultName';

interface NewTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roster: IFlow[];
  /** titles already in use, so a new team does not shadow an existing one */
  taken: string[];
  /** the id of the canvas that was created */
  onCreated: (agentId: string) => void;
}

const NewTeamDialog = ({
  open,
  onOpenChange,
  roster,
  taken,
  onCreated,
}: NewTeamDialogProps) => {
  const { t } = useTranslation();
  const create = useCreateTeam();
  const [title, setTitle] = useState('');
  const [process, setProcess] = useState<AgentTeamProcess>('parallel');
  const [picked, setPicked] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);

  const base = t(`flow.agentTeam.page.${NAME_BASE}`);
  const freshName = useMemo(() => {
    if (!taken.includes(base)) return base;
    let n = 2;
    while (taken.includes(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }, [base, taken]);

  /* opening starts from a name that is free and an empty crew — the dialog is
     reopened often, and stale choices would be carried over silently */
  useEffect(() => {
    if (!open) return;
    setTitle(freshName);
    setPicked([]);
    setProcess('parallel');
    setTouched(false);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, freshName]);

  const judgeNeedsTwo =
    ['vote', 'debate', 'consensus'].includes(process) && picked.length < 2;
  const nameOk = title.trim().length > 0;
  const crewOk = picked.length > 0 && !judgeNeedsTwo;
  const canSubmit = nameOk && crewOk && !create.isPending;

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );

  const submit = () => {
    setTouched(true);
    if (!canSubmit) return;
    const name = title.trim();
    create.mutate(
      {
        title: name,
        process,
        workerIds: picked,
        seed: {
          task: seedTaskText,
          expected: seedExpectedText(),
          manager: managerBrief(name),
        },
        prologue: t('flow.agentTeam.page.newTeamPrologue'),
      },
      { onSuccess: (agentId) => onCreated(agentId) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{t('flow.agentTeam.page.newTeam')}</DialogTitle>
          <DialogDescription>
            {t('flow.agentTeam.page.newTeamDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="nt-body">
          <label className="nt-field">
            <span className="nt-label">
              {t('flow.agentTeam.page.newTeamName')}
            </span>
            <input
              className="nt-input"
              value={title}
              placeholder={t('flow.agentTeam.page.newTeamNamePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
            {touched && !nameOk ? (
              <span className="nt-error">
                {t('flow.agentTeam.page.newTeamNameRequired')}
              </span>
            ) : null}
          </label>

          <div className="nt-field">
            <span className="nt-label">
              {t('flow.agentTeam.page.newTeamProcess')}
            </span>
            <div className="nt-chips" role="radiogroup">
              {AGENT_TEAM_PROCESSES.map((item) => {
                const Icon = PROCESS_ICONS[item];
                return (
                  <button
                    key={item}
                    type="button"
                    role="radio"
                    aria-checked={process === item}
                    data-on={process === item}
                    className="nt-chip"
                    onClick={() => setProcess(item)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t(`flow.agentTeam.process.${item}.label`)}
                  </button>
                );
              })}
            </div>
            <span className="nt-hint">
              {t('flow.agentTeam.page.newTeamProcessHint')}
            </span>
          </div>

          <div className="nt-field">
            <span className="nt-label">
              {t('flow.agentTeam.page.newTeamMembers')}
              <em className="nt-count">
                {t('flow.agentTeam.page.newTeamPicked', {
                  count: picked.length,
                })}
              </em>
            </span>
            <div className="nt-roster">
              {roster.map((agent) => {
                const on = picked.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    data-on={on}
                    className="nt-agent"
                    aria-pressed={on}
                    onClick={() => toggle(agent.id)}
                  >
                    <AgentAvatar seed={agent.id} size={30} className="nt-face" />
                    <span className="nt-agent-text">
                      <span className="nt-agent-name">
                        {agent.title || agent.id}
                      </span>
                      <span className="nt-agent-desc">
                        {agent.description ||
                          t('flow.agentTeam.page.assignAgent')}
                      </span>
                    </span>
                    <span className="nt-check" aria-hidden>
                      {on ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </button>
                );
              })}
              {roster.length === 0 ? (
                <p className="nt-hint">
                  {t('flow.agentTeam.page.newTeamNoAgents')}
                </p>
              ) : null}
            </div>
            {touched && !crewOk ? (
              <span className="nt-error">
                {judgeNeedsTwo
                  ? t('flow.agentTeam.page.newTeamJudgeNeedsTwo')
                  : t('flow.agentTeam.page.newTeamMembersRequired')}
              </span>
            ) : null}
          </div>

          {create.error ? (
            <p className="nt-error">{t('flow.agentTeam.page.newTeamFailed')}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="transparent"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t('flow.agentTeam.page.newTeamCancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {create.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            {create.isPending
              ? t('flow.agentTeam.page.newTeamCreating')
              : t('flow.agentTeam.page.newTeamCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewTeamDialog;
