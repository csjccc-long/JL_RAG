import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  default as StaggeredMenu,
  type StaggeredMenuItem,
} from '@/components/staggered-menu/staggered-menu';
import { Routes } from '@/routes';

const MenuPresentation: Record<
  string,
  Pick<StaggeredMenuItem, 'marquee' | 'effect'>
> = {
  [Routes.Chats]: { marquee: 'Chats', effect: 'waves' },
  [Routes.Searches]: { marquee: 'Searches', effect: 'silk' },
  [Routes.Agents]: { marquee: 'Agents', effect: 'scanner' },
  [Routes.Memories]: { marquee: 'Memories', effect: 'iridescence' },
};

export function HomeQuickAccess() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const options = useMemo(
    () => [
      { value: Routes.Chats, label: t('header.chat') },
      { value: Routes.Searches, label: t('header.search') },
      { value: Routes.Agents, label: t('header.flow') },
      { value: Routes.Memories, label: t('header.memories') },
    ],
    [t],
  );

  const menuItems = useMemo<StaggeredMenuItem[]>(
    () =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        ariaLabel: option.label,
        ...MenuPresentation[option.value],
      })),
    [options],
  );

  const quickLinks = useMemo(
    () => [
      { label: t('header.dataset'), to: Routes.Datasets },
      { label: t('header.fileManager'), to: Routes.Files },
    ],
    [t],
  );

  const handleSelect = useCallback(
    (item: StaggeredMenuItem) => {
      if (!item.value) return;
      navigate(item.value);
    },
    [navigate],
  );

  return (
    <StaggeredMenu
      items={menuItems}
      triggerLabel={t('header.quickAccess')}
      panelLabel={t('header.quickAccess')}
      links={quickLinks}
      linksTitle={t('header.quickLinks')}
      displayNumbering
      position="right"
      onSelect={handleSelect}
    />
  );
}
