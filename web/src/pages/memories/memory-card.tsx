import { MoreButton } from '@/components/more-button';
import { SharedBadge } from '@/components/shared-badge';
import { TruncatedText } from '@/components/truncated-text';
import { ParticleField } from '@/components/memory-card/particles-field';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { formatDate } from '@/utils/date';
import { IMemory } from './interface';
import { MemoryDropdown } from './memory-dropdown';
import './memory-card.css';

interface IProps {
  data: IMemory;
  showMemoryRenameModal: (data: IMemory) => void;
}

/**
 * Memory tile: a field of dots draws the memory logo across the whole card, the
 * words sit on the gradient along its bottom edge; hovering turns the field into
 * the neural skeleton.
 */
export function MemoryCard({ data, showMemoryRenameModal }: IProps) {
  const { navigateToMemory } = useNavigatePage();

  return (
    <article
      data-testid="memory-card"
      tabIndex={0}
      role="link"
      onClick={navigateToMemory(data?.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigateToMemory(data?.id)();
        }
      }}
      className="group mmem"
    >
      <ParticleField />

      <MemoryDropdown
        memory={data}
        showMemoryRenameModal={showMemoryRenameModal}
      >
        <MoreButton className="absolute right-2 top-2 z-20" />
      </MemoryDropdown>

      <div className="mmem-foot">
        <div className="mmem-title">
          <TruncatedText
            as="h3"
            className="min-w-0 flex-1 truncate text-[16px] font-bold leading-tight text-white/90"
            testId="memory-name"
            tooltip={data?.name}
          >
            {data?.name}
          </TruncatedText>
          <span className="mmem-led" />
        </div>
        <div className="mmem-meta">
          <span className="tabular-nums">{formatDate(data?.create_time)}</span>
          <SharedBadge>{data?.owner_name}</SharedBadge>
        </div>
      </div>
    </article>
  );
}
