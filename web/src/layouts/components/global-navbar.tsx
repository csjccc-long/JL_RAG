import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import { LucideHouse, LucideMenu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { APP_NAME } from '@/constants/common';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { HomeIcon } from '@/components/svg-icon';
import GooeyNav, { type GooeyNavItem } from '@/components/gooey-nav/gooey-nav';

const PathMap = {
  [Routes.Datasets]: [Routes.Datasets, Routes.DatasetBase],
  [Routes.Chats]: [Routes.Chats, Routes.Chat],
  [Routes.Searches]: [Routes.Searches, Routes.Search],
  [Routes.Agents]: [Routes.Agents, Routes.AgentTemplates],
  [Routes.Memories]: [Routes.Memories, Routes.Memory, Routes.MemoryMessage],
  [Routes.Files]: [Routes.Files],
} as const;

// Match on path-segment boundaries, not a loose substring, so e.g.
// "/user-setting/chat-channel" does not match the "/chat" tab.
const matchesPath = (pathname: string, candidate: string) =>
  pathname === candidate || pathname.startsWith(`${candidate}/`);

// Wrapper so dataset icon shares the same ComponentType<{ className? }>
// shape as Lucide icons in menuItems (avoids Element-vs-component union).
const MenuItemsIcon = ({
  className,
  name,
}: {
  className?: string;
  name?: string;
}) => <HomeIcon imgClass={className} name={name || 'datasets'} width={20} />;

const menuItems = [
  { path: Routes.Root, name: 'header.home', icon: LucideHouse },
  {
    path: Routes.Datasets,
    name: 'header.dataset',
    icon: MenuItemsIcon,
    icon_name: 'datasets',
  },
  {
    path: Routes.Chats,
    name: 'header.chat',
    icon: MenuItemsIcon,
    icon_name: 'chats',
    'data-testid': 'nav-chat',
  },
  {
    path: Routes.Searches,
    name: 'header.search',
    icon: MenuItemsIcon,
    icon_name: 'searches',
    'data-testid': 'nav-search',
  },
  {
    path: Routes.Agents,
    name: 'header.flow',
    icon: MenuItemsIcon,
    icon_name: 'agents',
    'data-testid': 'nav-agent',
  },
  {
    path: Routes.Memories,
    name: 'header.memories',
    icon: MenuItemsIcon,
    icon_name: 'memory',
  },
  {
    path: Routes.Files,
    name: 'header.fileManager',
    icon: MenuItemsIcon,
    icon_name: 'file',
  },
];

function useActivePath() {
  const { pathname } = useLocation();

  return useMemo(() => {
    return (
      Object.keys(PathMap).find((x: string) =>
        PathMap[x as keyof typeof PathMap].some((y: string) =>
          matchesPath(pathname, y),
        ),
      ) || pathname
    );
  }, [pathname]);
}

const buildNavItems = (t: (key: string) => string): GooeyNavItem[] =>
  menuItems.map((item) => {
    const { path, name } = item;
    const isHome = path === Routes.Root;

    return {
      href: path,
      label: isHome ? undefined : t(name),
      ariaLabel: t(name),
      testId: 'data-testid' in item ? item['data-testid'] : undefined,
      icon: isHome ? <LucideHouse className="size-6 stroke-[1.5]" /> : undefined,
    };
  });

type DesktopNavbarProps = {
  /** The hidden width probe renders only the measurable list shell. */
  effects?: boolean;
};

export function DesktopNavbar({ effects = true }: DesktopNavbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activePath = useActivePath();
  const items = useMemo(() => buildNavItems(t), [t]);
  const activeIndex = menuItems.findIndex(({ path }) => path === activePath);

  const handleNavigate = (
    event: React.MouseEvent<HTMLElement>,
    _index: number,
    item: GooeyNavItem,
  ) => {
    if (
      !item.href ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    navigate(item.href);
  };

  return (
    <GooeyNav
      items={items}
      activeIndex={activeIndex}
      effects={effects}
      onNavigate={handleNavigate}
      className="gooey-nav--rag"
      color="rgb(var(--text-primary))"
      activeTextColor="var(--bg-base)"
      hoverColor="var(--bg-input)"
      gooeyness={0.45}
      wobble={0.4}
      particleCount={12}
      spread={44}
      style={{
        '--gn-frame': 'var(--bg-card)',
        '--gn-frame-edge': 'var(--border-button)',
        '--gn-frame-highlight': 'transparent',
        '--gn-frame-shadow': 'none',
        '--gn-ink': 'rgb(var(--text-primary))',
        '--gn-muted': 'rgb(var(--text-secondary) / 0.9)',
      }}
    />
  );
}

function MobileNavItem({
  label,
  icon: Icon,
  icon_name,
  isActive,
  onClick,
  ...linkProps
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; name?: string }>;
  icon_name?: string;
  isActive?: boolean;
  onClick?: () => void;
  to: string;
  'data-testid'?: string;
}) {
  return (
    <Link
      {...linkProps}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3.5 px-4 py-3.5 text-base',
        'text-text-secondary transition-colors hover:bg-bg-card hover:text-text-primary',
        'focus-visible:bg-bg-card focus-visible:text-text-primary',
        isActive &&
          'border-l-2 border-text-primary bg-bg-card font-medium text-text-primary',
      )}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className="size-5 shrink-0 stroke-[1.5]" name={icon_name} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

type MobileNavbarProps = {
  renderFooter?: (close: () => void) => React.ReactNode;
};

export function MobileNavbar({ renderFooter }: MobileNavbarProps) {
  const { t } = useTranslation();
  const activePath = useActivePath();
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Menu"
        >
          <LucideMenu className="size-6 stroke-[1.75]" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        closeIcon={false}
        className="flex w-[min(85vw,18rem)] flex-col gap-0 p-0 sm:w-72"
      >
        <div className="flex shrink-0 justify-center py-5">
          <img src="/logo.svg" alt={`${APP_NAME} logo`} className="size-9" />
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto py-3">
          <ul className="space-y-1">
            {menuItems.map(({ path, name, icon_name, icon, ...props }) => (
              <li key={path}>
                <MobileNavItem
                  {...props}
                  to={path}
                  label={t(name)}
                  icon={icon}
                  icon_name={icon_name}
                  isActive={path === activePath}
                  onClick={close}
                />
              </li>
            ))}
          </ul>
        </nav>

        {renderFooter?.(close)}
      </SheetContent>
    </Sheet>
  );
}

const GlobalNavbar = DesktopNavbar;

export default GlobalNavbar;
