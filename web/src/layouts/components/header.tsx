import CrystalizedBall from '@/components/crystalized-ball/CrystalizedBall';
import { RAGFlowAvatar } from '@/components/ragflow-avatar';
import { useIsDarkTheme } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/constants/common';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChangeLanguage } from '@/hooks/logic-hooks';
import {
  useFetchUserInfo,
  useListTenant,
} from '@/hooks/use-user-setting-request';
import { cn } from '@/lib/utils';
import { TenantRole } from '@/pages/user-setting/constants';
import { Routes } from '@/routes';
import { LucideChevronDown, LucideLanguages } from 'lucide-react';
import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { BellButton } from './bell-button';
import { DesktopNavbar, MobileNavbar } from './global-navbar';
import ThemeButton from './theme-button';
import { useHeaderNavLayout } from './use-header-nav-layout';

import { supportedLanguages } from '@/locales/config';

export function Header({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const changeLanguage = useChangeLanguage();
  const isDark = useIsDarkTheme();

  const {
    data: { language = 'en', avatar, nickname },
  } = useFetchUserInfo();

  const { data: tenantData } = useListTenant();
  const hasNotification = useMemo(
    () => tenantData?.some((x) => x.role === TenantRole.Invite),
    [tenantData],
  );

  const currentLanguage = supportedLanguages.find((x) => x.code === language);

  const {
    headerRef,
    logoRef,
    expandedRightMeasureRef,
    navMeasureRef,
    isCompact,
  } = useHeaderNavLayout(`${hasNotification}-${language}`);

  return (
    <>
      <header
        ref={headerRef}
        key="app-navbar"
        className={cn(
          'w-full min-w-0 flex items-center gap-2 sm:gap-4',
          className,
        )}
        {...props}
      >
        <div className="inline-flex shrink-0 items-center gap-2">
          {isCompact && <MobileNavbar />}
          <div ref={logoRef} className="inline-flex shrink-0 items-center">
            <Link
              to={Routes.Root}
              aria-current={pathname === Routes.Root ? 'page' : undefined}
              className="group relative flex size-10 shrink-0 items-center justify-center"
            >
              <img src={'/logo.svg'} alt={`${APP_NAME} logo`} className="size-10" />
              {/* The tile stays still: only the transparent mark spins on hover. */}
              <img
                src={'/logo-mark.png'}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 size-10 transition-transform duration-700 ease-out group-hover:rotate-[360deg] motion-reduce:transition-none"
              />
            </Link>
          </div>
        </div>

        {!isCompact && (
          <div className="flex min-w-0 flex-1 justify-center">
            <DesktopNavbar />
          </div>
        )}

        {isCompact && <div className="flex-1" aria-hidden />}

        <div
          className={cn(
            'flex shrink-0 items-center justify-end text-text-badge',
            isCompact ? 'gap-0.5' : 'gap-4',
          )}
          data-testid="auth-status"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={cn(
                  'size-10 shrink-0 px-0',
                  !isCompact && 'size-auto gap-1 px-4',
                )}
                aria-label={currentLanguage?.displayName}
              >
                {isCompact && <LucideLanguages className="size-5" />}
                {!isCompact && (
                  <>
                    {currentLanguage?.displayName}
                    <LucideChevronDown className="size-[1em]" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              {supportedLanguages.map((x) => (
                <DropdownMenuItem
                  key={x.code}
                  onClick={() => changeLanguage(x.code)}
                >
                  {x.displayName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {!isCompact && hasNotification && (
            <BellButton className="!size-8" />
          )}

          <ThemeButton className={cn(!isCompact && '!size-8')} />

          <Link
            to={Routes.UserSetting}
            aria-label={nickname ? `${nickname} - User settings` : 'User settings'}
            className={cn(
              'group relative flex size-10 shrink-0 items-center justify-center rounded-full outline-none transition-shadow',
              'focus-visible:ring-2 focus-visible:ring-accent-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
              !isCompact && 'ms-3',
            )}
            data-testid="settings-entrypoint"
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.detail === 0
              ) {
                return;
              }
              event.preventDefault();
              window.setTimeout(() => navigate(Routes.UserSetting), 420);
            }}
          >
            <span aria-hidden className="pointer-events-none block size-10">
              <CrystalizedBall
                preset="plasma"
                color="#F25BD0"
                theme={isDark ? 'dark' : 'light'}
                size={0.7}
                crackle={0.85}
                fill={0.5}
                interactive
                hoverStrength={0.7}
                strands={6}
                flares={0.65}
                glow={0.9}
                sparks={0.6}
                particleCount={15000}
                motion="rise"
                particleShape="square"
                depth={0.6}
                sway={0.5}
                twinkle={0.5}
                haze={0.7}
                dustSpeed={1}
                speed={1}
                intro
                paused={false}
                burstOnClick
              />
            </span>
          </Link>
        </div>
      </header>

      <div
        className="pointer-events-none invisible fixed -left-[9999px] top-0"
        aria-hidden
      >
        <div ref={navMeasureRef}>
          <DesktopNavbar effects={false} />
        </div>
        <div
          ref={expandedRightMeasureRef}
          className="inline-flex shrink-0 items-center justify-end gap-4 text-text-badge"
        >
          <Button variant="ghost" className="size-auto gap-1 px-4">
            {currentLanguage?.displayName}
            <LucideChevronDown className="size-[1em]" />
          </Button>
          <ThemeButton className="!size-8" />
          {hasNotification && <BellButton className="!size-8" />}
          <div className="relative ms-3 flex size-10 shrink-0 items-center justify-center">
            <RAGFlowAvatar
              name={nickname}
              avatar={avatar}
              isPerson
              className="size-8"
            />
          </div>
        </div>
      </div>
    </>
  );
}
