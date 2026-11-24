import { Outlet, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { Routes } from '@/routes';
import { Header } from './components/header';

export function RootLayoutContainer({ children }: React.PropsWithChildren) {
  const { pathname } = useLocation();
  // The home poster owns the whole viewport: its background must reach the very
  // top edge, so the header floats above it instead of taking a row of the grid.
  const isHome = pathname === Routes.Root;

  return (
    <div
      className={cn(
        'size-full min-w-0 grid grid-flow-col grid-cols-1',
        isHome ? 'relative grid-rows-[1fr]' : 'grid-rows-[auto_1fr]',
      )}
    >
      <Header
        className={cn('px-5 py-4', isHome && 'absolute inset-x-0 top-0 z-40')}
      />

      <main className="size-full min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}

export default function RootLayout() {
  return (
    <RootLayoutContainer>
      <Outlet />
    </RootLayoutContainer>
  );
}
