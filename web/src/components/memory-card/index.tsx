'use client';

import { cn } from '@/lib/utils';

import { ParticleField } from './particles-field';
import './memory-card.css';

export type MemoryCardProps = {
  /** Card heading, e.g. 记忆01 — the sleeve number of the card. */
  heading: string;
  /** The memory itself, printed over the field. */
  title: string;
  /** Timestamp line at the very bottom. */
  meta: string;
  /** Small mono caption next to the timestamp, e.g. the memory type. */
  badge?: string;
  removeLabel?: string;
  onRemove?: () => void;
  removePending?: boolean;
  className?: string;
};

/**
 * A memory rendered as a dot field that fills the whole card: the dots are the
 * artwork, the words sit on the gradient at the bottom, and a press throws the
 * dots out before they regroup.
 */
export const MemoryCard = ({
  heading,
  title,
  meta,
  badge,
  removeLabel,
  onRemove,
  removePending = false,
  className,
}: MemoryCardProps) => (
  <article className={cn('mcard', className)}>
    <ParticleField />
    <div className="mcard-foot">
      <p className="mcard-heading">{heading}</p>
      <p className="mcard-title">{title}</p>
      <div className="mcard-row">
        <span className="mcard-meta">{meta}</span>
        {badge ? <span className="mcard-badge">{badge}</span> : null}
      </div>
    </div>
    {onRemove && removeLabel ? (
      <button
        type="button"
        className="mcard-remove"
        disabled={removePending}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        {removeLabel}
      </button>
    ) : null}
  </article>
);

export default MemoryCard;
