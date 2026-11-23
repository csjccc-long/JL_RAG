import { cn } from '@/lib/utils';

type DeltaBadgeProps = {
  value: string;
  isPositive: boolean;
};

export function DeltaBadge({ value, isPositive }: DeltaBadgeProps) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-xs leading-none font-medium',
        isPositive
          ? 'bg-state-success/10 text-state-success'
          : 'bg-state-error/10 text-state-error',
      )}
    >
      {value}
    </span>
  );
}
