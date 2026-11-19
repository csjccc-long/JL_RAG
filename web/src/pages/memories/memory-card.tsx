import { MoreButton } from '@/components/more-button';
import { SharedBadge } from '@/components/shared-badge';
import { TruncatedText } from '@/components/truncated-text';
import { ParticleField, PARTICLE_SHAPES } from '@/components/memory-card/particles-field';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { formatDate } from '@/utils/date';
import { useMemo } from 'react';
import { IMemory } from './interface';
import { MemoryDropdown } from './memory-dropdown';
import './memory-card.css';

interface IProps {
  data: IMemory;
  showMemoryRenameModal: (data: IMemory) => void;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Memory tile: a field of dots fills the whole card, the words sit on the
 * gradient along its bottom edge. The silhouette is derived from the memory id,
 * so a list reads as a family of shapes; hovering pushes the dots aside.
 */
export function MemoryCard({ data, showMemoryRenameModal }: IProps) {
  const { navigateToMemory } = useNavigatePage();

  const shape = useMemo(
    () =>
      PARTICLE_SHAPES[
        hashString(String(data?.id ?? data?.name ?? 'memory')) %
          PARTICLE_SHAPES.length
      ],
    [data?.id, data?.name],
  );

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
      <ParticleField shape={shape} />

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
