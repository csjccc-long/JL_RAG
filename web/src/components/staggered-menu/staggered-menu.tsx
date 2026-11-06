import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LucideX } from 'lucide-react';

import { cn } from '@/lib/utils';

import GradientWaves from './backgrounds/GradientWaves';
import Iridescence from './backgrounds/Iridescence';
import Scanner from './backgrounds/Scanner';
import Silk from './backgrounds/Silk';
import { useFlowingBand } from './use-flowing-band';
import './staggered-menu.css';

export type StaggeredMenuItem = {
  label: string;
  ariaLabel?: string;
  value?: string;
  /** Text scrolling through the hover band; defaults to label. */
  marquee?: string;
  /** Animated backdrop painted inside the hover band. */
  effect?: 'waves' | 'silk' | 'scanner' | 'iridescence';
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
  const {
    listRef,
    copies,
    activeIndex,
    registerRow,
    registerBand,
    registerTrack,
    reset,
    handlePointerMove,
    handlePointerLeave,
    handleFocus,
    handleBlur,
  } = useFlowingBand();

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

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
          ref={listRef}
          className="sm-list"
          data-numbering={displayNumbering || undefined}
          onClick={handleListClick}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onFocus={handleFocus}
          onBlur={handleBlur}
        >
          {items.map((item, index) => (
            <li
              className="sm-item"
              key={item.value ?? item.label + index}
              ref={registerRow(index)}
            >
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
                  <span className="sm-item-text">{item.label}</span>
                </span>
                {displayNumbering && (
                  <span className="sm-item-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                )}
              </button>
              <span
                className={cn(
                  'sm-band',
                  item.effect && 'sm-band--media',
                  item.effect && `sm-band--${item.effect}`,
                )}
                aria-hidden="true"
                ref={registerBand(index)}
              >
                {open && item.effect && (
                  <span
                    className={cn(
                      'sm-band-media',
                      item.effect === 'waves' && 'sm-band-media--waves',
                      item.effect === 'scanner' && 'sm-band-media--scanner',
                      item.effect === 'iridescence' &&
                        'sm-band-media--iridescence',
                    )}
                  >
                    {item.effect === 'waves' ? (
                      <GradientWaves
                        fogDepth={100}
                        paused={activeIndex !== index}
                        mouseInteraction={activeIndex === index}
                        swellOnClick={false}
                      />
                    ) : item.effect === 'silk' ? (
                      <Silk
                        paused={activeIndex !== index}
                        mouseInteraction={activeIndex === index}
                        clickRipple={false}
                      />
                    ) : item.effect === 'scanner' ? (
                      <Scanner
                        scale={1.35}
                        bandDensity={8}
                        lineWidth={1.5}
                        brightness={1.9}
                        glow={0.8}
                        vignette={0.12}
                        scanlineIntensity={0.3}
                        sweepSpeed={0.3}
                        scanline
                        grain
                        intro
                        paused={activeIndex !== index}
                        mouseInteraction={activeIndex === index}
                        clickEffect={activeIndex === index ? 'ping' : 'none'}
                      />
                    ) : (
                      <Iridescence
                        color="#8099cc"
                        brightness={1.25}
                        speed={0.8}
                        paused={activeIndex !== index}
                        mouseReact={activeIndex === index}
                        clickSwirl={false}
                      />
                    )}
                  </span>
                )}
                {item.effect && <span className="sm-band-shade" />}
                <span className="sm-band-track" ref={registerTrack(index)}>
                  {Array.from({ length: copies[index] ?? 3 }, (_, copy) => (
                    <span className="sm-band-part" key={copy}>
                      {item.marquee ?? item.label}
                    </span>
                  ))}
                </span>
              </span>
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
