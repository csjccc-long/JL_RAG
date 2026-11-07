import { Button } from '@/components/ui/button';
import { hashSeed, TYPE_COLORS } from '@/pages/memories/brain-model';
import memoryService from '@/services/memory-service';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useFetchMemoryBaseConfiguration } from '../hooks/use-memory-setting';
import { useFetchMemoryMessageList } from './hook';
import { IMessageContentProps, IMessageInfo } from './interface';
import { NeuronStage } from './neuron-stage';

const TYPE_LABELS: Record<string, string> = {
  semantic: '语义',
  episodic: '情景',
  procedural: '程序',
  raw: '原始',
};

// the service answers "Unknown" when a message carries no agent, which reads
// like a failure; fall back to the type and the id instead
const agentLabel = (message: IMessageInfo) =>
  message.agent_name && message.agent_name !== 'Unknown'
    ? message.agent_name
    : `${TYPE_LABELS[message.message_type] ?? message.message_type} #${message.message_id}`;

export default function MemoryMessage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const { data } = useFetchMemoryMessageList();
  const { data: base } = useFetchMemoryBaseConfiguration();
  const messages = useMemo(
    () => data?.messages?.message_list ?? [],
    [data?.messages?.message_list],
  );
  const [activeId, setActiveId] = useState<number | null>(null);
  const [content, setContent] = useState<IMessageContentProps | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeId === null && messages.length) {
      setActiveId(messages[0].message_id);
    }
  }, [messages, activeId]);

  useEffect(() => {
    let alive = true;
    if (activeId === null || !id) {
      setContent(null);
      return;
    }
    setLoading(true);
    memoryService
      .getMessageContent({ memory_id: id, message_id: String(activeId) })
      .then((res) => {
        if (alive) setContent(res.data?.data ?? null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeId, id]);

  const active = useMemo(
    () => messages.find((m) => m.message_id === activeId),
    [messages, activeId],
  );
  const seed = useMemo(() => hashSeed(id ?? 'memory'), [id]);
  const embed = content?.content_embed;
  const embedDims = Array.isArray(embed)
    ? embed.length
    : embed
      ? embed.trim().split(/[,\s]+/).length
      : 0;
  const embedText = Array.isArray(embed)
    ? embed.map((value) => value.toFixed(4)).join(', ')
    : embed;
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const activeColour = active
    ? TYPE_COLORS[active.message_type]?.[dark ? 'dark' : 'light'] ?? '#54e3d6'
    : '#54e3d6';

  return (
    <div className="flex size-full min-h-0 flex-col">
      <header className="flex items-start gap-3 px-5 pb-4 pt-6">
        <Button
          variant="ghost"
          size="icon"
          className="mt-0.5 shrink-0"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-text-primary">
            {base?.name || t('memory.sideBar.messages')}
          </h1>
          <p className="truncate text-xs text-text-secondary">
            {base?.description || t('memory.messages.messageDescription')}
          </p>
        </div>
        <span className="ml-auto shrink-0 self-center rounded-full border border-border-default px-3 py-1 text-xs text-text-secondary">
          {messages.length} 条消息
        </span>
      </header>

      <div className="flex min-h-0 flex-1 border-t border-border-default">
        <NeuronStage
          seed={seed}
          messages={messages}
          activeId={activeId}
          onSelect={(message: IMessageInfo) => setActiveId(message.message_id)}
        />

        <aside className="flex w-[370px] shrink-0 flex-col border-l border-border-default">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
            <span className="text-xs uppercase tracking-[0.18em] text-text-secondary/70">
              消息
            </span>
            <span className="text-xs text-text-secondary">{messages.length}</span>
          </div>

          <div className="max-h-[42%] shrink-0 overflow-auto py-1">
            {messages.length === 0 && (
              <p className="px-4 py-6 text-xs text-text-secondary/70">
                暂无抽取出的消息
              </p>
            )}
            {messages.map((message) => {
              const colour =
                TYPE_COLORS[message.message_type]?.[dark ? 'dark' : 'light'] ??
                '#54e3d6';
              const selected = message.message_id === activeId;
              return (
                <button
                  key={message.message_id}
                  type="button"
                  onClick={() => setActiveId(message.message_id)}
                  className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    selected ? 'bg-bg-card' : 'hover:bg-bg-card/60'
                  }`}
                >
                  <i
                    className="mt-1.5 size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colour }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-text-primary">
                      {agentLabel(message)}
                    </span>
                    <span className="block truncate text-[11px] text-text-secondary">
                      {TYPE_LABELS[message.message_type] ?? message.message_type}
                      {message.valid_at ? ` · ${message.valid_at}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-border-default">
            {active ? (
              <>
                <div className="flex items-center gap-2 px-4 py-3">
                  <i
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: activeColour }}
                  />
                  <span className="truncate text-xs text-text-secondary">
                    {TYPE_LABELS[active.message_type] ?? active.message_type}
                    {active.agent_name && active.agent_name !== 'Unknown'
                      ? ` · ${active.agent_name}`
                      : ''}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-text-secondary/60">
                    #{active.message_id}
                  </span>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-4 pb-5">
                  {loading ? (
                    <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
                      <Loader2 className="size-3.5 animate-spin" />
                      读取中
                    </div>
                  ) : content?.content ? (
                    <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-text-primary">
                      {content.content}
                    </pre>
                  ) : (
                    <p className="py-4 text-xs text-text-secondary/70">暂无内容</p>
                  )}
                  {embed && (
                    <details className="mt-4 border-t border-border-default pt-3">
                      <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.14em] text-text-secondary/60 transition-colors hover:text-text-secondary">
                        向量 · {embedDims} 维
                      </summary>
                      <p className="mt-2 max-h-32 overflow-auto break-all text-[11px] leading-relaxed text-text-secondary/45">
                        {embedText}
                      </p>
                    </details>
                  )}
                </div>
              </>
            ) : (
              <p className="px-4 py-5 text-xs text-text-secondary/70">
                选择一条消息查看内容
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
