import { CardSineLineContainer } from '@/components/card-singleline-container';
import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import { HomeIcon } from '@/components/svg-icon';
import {
  default as StaggeredMenu,
  type StaggeredMenuItem,
} from '@/components/staggered-menu/staggered-menu';
import { Routes } from '@/routes';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Agents } from './agent-list';
import { SeeAllAppCard } from './application-card';
import { ChatList } from './chat-list';
import { MemoryList } from './memory-list';
import { SearchList } from './search-list';

const IconMap = {
  [Routes.Chats]: 'chats',
  [Routes.Searches]: 'searches',
  [Routes.Agents]: 'agents',
  [Routes.Memories]: 'memory',
};

const MenuPresentation: Record<string, Pick<StaggeredMenuItem, 'marquee' | 'effect'>> = {
  [Routes.Chats]: { marquee: 'Chats', effect: 'waves' },
  [Routes.Searches]: { marquee: 'Searches', effect: 'silk' },
  [Routes.Agents]: { marquee: 'Agents', effect: 'scanner' },
  [Routes.Memories]: { marquee: 'Memories', effect: 'iridescence' },
};

const EmptyTypeMap = {
  [Routes.Chats]: EmptyCardType.Chat,
  [Routes.Searches]: EmptyCardType.Search,
  [Routes.Agents]: EmptyCardType.Agent,
  [Routes.Memories]: EmptyCardType.Memory,
};

export function Applications() {
  const [val, setVal] = useState(Routes.Chats);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [listLength, setListLength] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleNavigate = useCallback(
    ({ isCreate }: { isCreate?: boolean }) => {
      if (isCreate) {
        navigate(val + '?isCreate=true');
      } else {
        navigate(val);
      }
    },
    [navigate, val],
  );

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

  const handleChange = useCallback((item: StaggeredMenuItem) => {
    if (!item.value) return;
    setVal(item.value as Routes);
    setListLength(0);
    setLoading(true);
  }, []);

  return (
    <>
      <div className="fixed right-5 top-[76px] z-30">
        <StaggeredMenu
          items={menuItems}
          value={val}
          triggerLabel={options.find((x) => x.value === val)?.label ?? ''}
          panelLabel={t('header.quickAccess')}
          links={quickLinks}
          linksTitle={t('header.quickLinks')}
          displayNumbering
          position="right"
          onSelect={handleChange}
        />
      </div>

      <section className="mt-12">
      <header className="flex justify-between items-center mb-2.5">
        <h2 className="text-2xl font-semibold">
          <HomeIcon
            imgClass="me-2.5"
            name={`${IconMap[val as keyof typeof IconMap]}`}
            width={24}
          />
          {options.find((x) => x.value === val)?.label}
        </h2>
      </header>

      {/* <div className="flex flex-wrap gap-4"> */}
      <CardSineLineContainer>
        {val === Routes.Agents && (
          <Agents
            setListLength={(length: number) => setListLength(length)}
            setLoading={(loading: boolean) => setLoading(loading)}
          />
        )}
        {val === Routes.Chats && (
          <ChatList
            setListLength={(length: number) => setListLength(length)}
            setLoading={(loading: boolean) => setLoading(loading)}
          />
        )}
        {val === Routes.Searches && (
          <SearchList
            setListLength={(length: number) => setListLength(length)}
            setLoading={(loading: boolean) => setLoading(loading)}
          />
        )}
        {val === Routes.Memories && (
          <MemoryList
            setListLength={(length: number) => setListLength(length)}
            setLoading={(loading: boolean) => setLoading(loading)}
          />
        )}
        {listLength > 0 && (
          <SeeAllAppCard click={() => handleNavigate({ isCreate: false })} />
        )}
      </CardSineLineContainer>

      {listLength <= 0 && !loading && (
        <div className="w-[210px]">
          <EmptyAppCard
            type={EmptyTypeMap[val as keyof typeof EmptyTypeMap]}
            onClick={() => handleNavigate({ isCreate: true })}
          />
        </div>
      )}
      {/* </div> */}
      </section>
    </>
  );
}
