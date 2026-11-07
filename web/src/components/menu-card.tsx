import { DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import * as React from 'react';

/**
 * Card-style dropdown used by every "..." (MoreButton) menu.
 * Layout and hover behavior follow the Uiverse "card menu" reference:
 * a 200px card with grouped icon+label rows, blue hover and a red danger row.
 */
const cardStyle: React.CSSProperties = {
  width: 200,
  minWidth: 200,
  padding: '15px 0',
  border: 'none',
  borderRadius: 10,
  backgroundColor: 'rgb(var(--menu-surface))',
  backgroundImage:
    'linear-gradient(139deg, rgb(var(--menu-surface)) 0%, rgb(var(--menu-surface)) 0%, rgb(var(--menu-surface-tint)) 100%)',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const MenuCard = React.forwardRef<
  React.ElementRef<typeof DropdownMenuContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuContent>
>(({ className, style, ...props }, ref) => (
  <DropdownMenuContent
    ref={ref}
    className={cn(
      'p-0 text-menu-text',
      // rows: 10px side inset, 4px/7px padding, 6px radius, left-aligned icon + label
      '[&_[role=menuitem]]:mx-2.5 [&_[role=menuitem]]:my-0 [&_[role=menuitem]]:cursor-pointer',
      '[&_[role=menuitem]]:gap-2.5 [&_[role=menuitem]]:rounded-md [&_[role=menuitem]]:px-[7px] [&_[role=menuitem]]:py-1',
      '[&_[role=menuitem]]:text-sm [&_[role=menuitem]]:font-semibold [&_[role=menuitem]]:text-menu-text',
      '[&_[role=menuitem]]:transition-all [&_[role=menuitem]]:duration-300 [&_[role=menuitem]]:ease-out',
      '[&_[role=menuitem]]:flex-row-reverse [&_[role=menuitem]]:justify-end',
      '[&_[role=menuitem]_svg]:size-[19px]',
      // hover / keyboard highlight
      '[&_[role=menuitem][data-highlighted]]:bg-menu-hover [&_[role=menuitem][data-highlighted]]:text-menu-hover-text',
      '[&_[role=menuitem][data-highlighted]]:translate-x-px [&_[role=menuitem][data-highlighted]]:-translate-y-px',
      '[&_[role=menuitem]]:active:scale-[0.99]',
      '[&_[role=menuitem].text-state-error[data-highlighted]]:!bg-menu-danger',
      // full-width 1.5px separator
      '[&_[role=separator]]:mx-0 [&_[role=separator]]:my-0 [&_[role=separator]]:h-[1.5px] [&_[role=separator]]:bg-menu-border',
      className,
    )}
    style={{ ...cardStyle, ...style }}
    {...props}
  />
));
MenuCard.displayName = 'MenuCard';

export { MenuCard };
