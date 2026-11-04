import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { LucideX } from 'lucide-react';

import { cn } from '@/lib/utils';

import './staggered-menu.css';

export type StaggeredMenuItem = {
  label: string;
  ariaLabel?: string;
  value?: string;
  icon?: ReactNode;
};

export type StaggeredMenuLink = {
  label: string;
  to: string;
};

export type StaggeredMenuProps = {
  items: StaggeredMenuItem[];
  /** Currently selected item value, highlighted inside the panel. */
  value?: string;
  /** Text shown on the trigger button while closed. */
  triggerLabel: string;
  /** Text shown on the trigger button while open. */
  openLabel?: string;
  /** Accessible name for the dialog. */
  panelLabel?: string;
  /** Optional secondary links rendered at the bottom of the panel. */
  links?: StaggeredMenuLink[];
  linksTitle?: string;
  /** Layered backdrop colors, deepest first (max 4). */
  colors?: string[];
  accentColor?: string;
  displayNumbering?: boolean;
  position?: 'left' | 'right';
  onSelect?: (item: StaggeredMenuItem, index: number) => void;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

const DEFAULT_COLORS = [
  'rgb(var(--accent-primary) / 0.12)',
  'rgb(var(--accent-primary) / 0.24)',
];

const StaggeredMenu = ({
  items,
  value,
  triggerLabel,
  openLabel = '关闭',
  panelLabel = '快捷栏',
  links = [],
  linksTitle,
  colors = DEFAULT_COLORS,
  accentColor = 'rgb(var(--accent-primary))',
  displayNumbering = true,
  position = 'right',
  onSelect,
  onOpenChange,
  className,
}: StaggeredMenuProps) => {
  const [open, setOpen] = useState(false);
  const panelId = useId().replace(/:/g, '');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  const setMenuOpen = useCallback(
    (next: boolean) => {
      setOpen((current) => {
        if (current === next) return current;
        onOpenChange?.(next);
        return next;
      });
    },
    [onOpenChange],
  );

  const handleTriggerClick = useCallback(() => {
    setMenuOpen(!open);
  }, [open, setMenuOpen]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.inert = !open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) triggerRef.current?.focus();
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    const timer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('.sm-item-button')
        ?.focus();
    }, 240);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('button, a[href]'),
      ).filter((element) => !element.hasAttribute('disabled'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, setMenuOpen]);

  const handleListClick = useCallback(
    (event: React.MouseEvent<HTMLUListElement>) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-sm-index]',
      );
      if (!target) return;
      const index = Number(target.dataset.smIndex);
      const item = items[index];
      if (!item) return;
      onSelect?.(item, index);
      setMenuOpen(false);
    },
    [items, onSelect, setMenuOpen],
  );

  const handlePanelClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) setMenuOpen(false);
    },
    [setMenuOpen],
  );

  const handleCloseClick = useCallback(() => setMenuOpen(false), [setMenuOpen]);
  const handleScrimClick = useCallback(() => setMenuOpen(false), [setMenuOpen]);

  const prelayers = (colors.length ? colors : DEFAULT_COLORS).slice(0, 4);

  return (
    <div
      className={cn('staggered-menu', className)}
      data-open={open || undefined}
      data-position={position}
      style={{ '--sm-accent': accentColor } as React.CSSProperties}
    >
      <button
        ref={triggerRef}
        type="button"
        className="sm-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={open ? openLabel : triggerLabel}
        onClick={handleTriggerClick}
      >
        <span className="sm-trigger-text">
          <span className="sm-trigger-lines" aria-hidden="true">
            <span className="sm-trigger-line">{triggerLabel}</span>
            <span className="sm-trigger-line">{openLabel}</span>
          </span>
        </span>
        <span className="sm-icon" aria-hidden="true">
          <span className="sm-icon-line sm-icon-line-h" />
          <span className="sm-icon-line sm-icon-line-v" />
        </span>
      </button>

      <div className="sm-scrim" aria-hidden="true" onClick={handleScrimClick} />

      <div className="sm-prelayers" aria-hidden="true">
        {prelayers.map((color, index) => (
          <div
            key={index}
            className="sm-prelayer"
            style={
              {
                background: color,
                '--sm-delay': index * 0.07 + 's',
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div
        id={panelId}
        ref={panelRef}
        className="sm-panel"
        role="dialog"
        aria-modal="true"
        aria-label={panelLabel}
        aria-hidden={!open}
        onClick={handlePanelClick}
      >
        <div className="sm-panel-top">
          <span className="sm-panel-title">{panelLabel}</span>
          <button
            type="button"
            className="sm-close"
            aria-label={openLabel}
            onClick={handleCloseClick}
          >
            <LucideX className="size-4" />
          </button>
        </div>

        <ul
          className="sm-list"
          data-numbering={displayNumbering || undefined}
          onClick={handleListClick}
        >
          {items.map((item, index) => (
            <li className="sm-item" key={item.value ?? item.label + index}>
              <button
                type="button"
                className="sm-item-button"
                data-sm-index={index}
                data-active={item.value === value || undefined}
                aria-current={item.value === value ? 'true' : undefined}
                aria-label={item.ariaLabel ?? item.label}
              >
                <span
                  className="sm-item-label"
                  style={{ '--sm-i': index } as React.CSSProperties}
                >
                  <span className="sm-item-icon">{item.icon}</span>
                  <span className="sm-item-text">{item.label}</span>
                </span>
                {displayNumbering && (
                  <span className="sm-item-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>

        {links.length > 0 && (
          <div className="sm-links">
            {linksTitle && <span className="sm-links-title">{linksTitle}</span>}
            <div className="sm-links-row">
              {links.map((link) => (
                <Link
                  key={link.to}
                  className="sm-link"
                  to={link.to}
                  onClick={handleCloseClick}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaggeredMenu;
