import { BrainLogo } from '@/components/brain-logo';
import { EmptyCardType } from '@/components/empty/constant';
import { EmptyAppCard } from '@/components/empty/empty';
import ListFilterBar from '@/components/list-filter-bar';
import { Button } from '@/components/ui/button';
import { RAGFlowPagination } from '@/components/ui/ragflow-pagination';
import { useTranslate } from '@/hooks/common-hooks';
import { useGoToPreviousPageOnEmpty } from '@/hooks/logic-hooks';
import { useNavigatePage } from '@/hooks/logic-hooks/navigate-hooks';
import { cn } from '@/lib/utils';
import { pick } from 'lodash';
import { Brain, LayoutGrid, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AddOrEditModal } from './add-or-edit-modal';
import { defaultMemoryFields } from './constants';
import { useFetchMemoryList, useRenameMemory, useSelectFilters } from './hooks';
import { ICreateMemoryProps, IMemory } from './interface';
import { MemoryBrain } from './memory-brain';
import { MemoryCard } from './memory-card';

export default function MemoryList() {
  // const { data } = useFetchFlowList();
  const { t } = useTranslate('memories');
  const { navigateToMemory } = useNavigatePage();
  const [addOrEditType, setAddOrEditType] = useState<'add' | 'edit'>('add');
  // the brain is the default reading of the memory module; the grid stays one
  // click away for renaming and bulk browsing
  const [view, setView] = useState<'brain' | 'grid'>(() => {
    if (typeof window === 'undefined') return 'brain';
    return window.localStorage.getItem('memories:view') === 'grid'
      ? 'grid'
      : 'brain';
  });
  const changeView = useCallback((next: 'brain' | 'grid') => {
    setView(next);
    window.localStorage.setItem('memories:view', next);
  }, []);
  // const [isEdit, setIsEdit] = useState(false);
  const {
    data: list,
    isLoading,
    pagination,
    searchString,
    handleInputChange,
    setPagination,
    refetch: refetchList,
    filterValue,
    handleFilterSubmit,
  } = useFetchMemoryList();

  const {
    openCreateModal,
    showMemoryRenameModal,
    hideMemoryModal,
    memoryRenameLoading,
    onMemoryRenameOk,
    initialMemory,
  } = useRenameMemory();

  const onMemoryConfirm = (data: ICreateMemoryProps) => {
    onMemoryRenameOk(data, () => {
      refetchList();
    });
  };
  const openCreateModalFun = useCallback(() => {
    // setIsEdit(false);
    setAddOrEditType('add');
    showMemoryRenameModal(defaultMemoryFields as unknown as IMemory);
  }, [showMemoryRenameModal]);
  const handlePageChange = useCallback(
    (page: number, pageSize?: number) => {
      setPagination({ page, pageSize });
    },
    [setPagination],
  );
  useGoToPreviousPageOnEmpty(list?.data?.memory_list?.length, isLoading);

  const [searchUrl, setMemoryUrl] = useSearchParams();
  const { filters } = useSelectFilters();
  const isCreate = searchUrl.get('isCreate') === 'true';
  useEffect(() => {
    if (isCreate) {
      openCreateModalFun();
      searchUrl.delete('isCreate');
      setMemoryUrl(searchUrl);
    }
  }, [isCreate, openCreateModalFun, searchUrl, setMemoryUrl]);

  return (
    <>
      {list?.data?.memory_list?.length || searchString ? (
        <article
          className="size-full min-w-0 flex flex-col"
          data-testid="memory-list"
        >
          <header className="mb-4 min-w-0 px-5 pt-8">
            <ListFilterBar
              icon={<BrainLogo className="size-[1.1em] shrink-0" />}
              title={t('memory')}
              onSearchChange={handleInputChange}
              searchString={searchString}
              filters={filters}
              onChange={handleFilterSubmit}
              value={filterValue}
              preChildren={
                <div className="flex items-center gap-0.5 rounded-full border border-border-default p-0.5">
                  <button
                    type="button"
                    onClick={() => changeView('brain')}
                    aria-pressed={view === 'brain'}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
                      view === 'brain'
                        ? 'bg-bg-card text-text-primary'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    <Brain className="size-3.5" />
                    {t('brainView')}
                  </button>
                  <button
                    type="button"
                    onClick={() => changeView('grid')}
                    aria-pressed={view === 'grid'}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
                      view === 'grid'
                        ? 'bg-bg-card text-text-primary'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    <LayoutGrid className="size-3.5" />
                    {t('listView')}
                  </button>
                </div>
              }
            >
              <Button onClick={() => openCreateModalFun()}>
                <Plus className="size-[1em]" />
                {t('createMemory')}
              </Button>
            </ListFilterBar>
          </header>

          {list?.data?.memory_list?.length ? (
            view === 'brain' ? (
              <MemoryBrain
                memories={list.data.memory_list}
                onOpen={(id) => navigateToMemory(id)()}
                className="w-full flex-1"
              />
            ) : (
              <>
                <div className="grid flex-1 content-start gap-x-32 gap-y-5 overflow-auto px-5 grid-cols-[repeat(auto-fill,minmax(248px,1fr))]">
                  {list?.data.memory_list.map((x) => (
                    <MemoryCard
                      key={x.id}
                      data={x}
                      showMemoryRenameModal={() => {
                        setAddOrEditType('edit');
                        showMemoryRenameModal(x);
                      }}
                    />
                  ))}
                </div>

                <footer className="mt-4 px-5 pb-5">
                  <RAGFlowPagination
                    {...pick(pagination, 'current', 'pageSize')}
                    total={list?.data.total_count}
                    onChange={handlePageChange}
                  />
                </footer>
              </>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center px-5">
              <EmptyAppCard
                showIcon
                size="large"
                isSearch
                type={EmptyCardType.Memory}
                onClick={() => openCreateModalFun()}
              />
            </div>
          )}
        </article>
      ) : (
        <article
          className="size-full min-w-0 flex items-center justify-center px-5"
          data-testid="memory-list"
        >
          <EmptyAppCard
            showIcon
            size="large"
            type={EmptyCardType.Memory}
            onClick={() => openCreateModalFun()}
          />
        </article>
      )}
      {/* {openCreateModal && (
        <RenameDialog
          hideModal={hideMemoryRenameModal}
          onOk={onMemoryRenameConfirm}
          initialName={initialMemoryName}
          loading={memoryRenameLoading}
          title={<HomeIcon name="memory" width={'24'} />}
        ></RenameDialog>
      )} */}
      {openCreateModal && (
        <AddOrEditModal
          initialMemory={initialMemory}
          isCreate={addOrEditType === 'add'}
          open={openCreateModal}
          loading={memoryRenameLoading}
          onClose={hideMemoryModal}
          onSubmit={onMemoryConfirm}
        />
      )}
    </>
  );
}
