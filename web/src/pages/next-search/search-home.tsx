/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { PromptInput } from '@/components/ai-prompt-input';
import Spotlight from '@/components/spotlight';
import message from '@/components/ui/message';
import { IUserInfo } from '@/interfaces/database/user-setting';
import { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ISearchAppDetailProps } from '../next-searches/hooks';
import './index.less';
import { RAGFlowLogo } from './ragflow-logo';
import { useSummarySettings } from './use-summary-settings';

export default function SearchHome({
  isSearching,
  setIsSearching,
  searchText,
  setSearchText,
  userInfo,
  canSearch,
  showEmbedLogo,
  searchData,
}: {
  isSearching: boolean;
  setIsSearching: Dispatch<SetStateAction<boolean>>;
  searchText: string;
  setSearchText: Dispatch<SetStateAction<string>>;
  userInfo?: IUserInfo;
  canSearch?: boolean;
  showEmbedLogo?: boolean;
  searchData?: ISearchAppDetailProps;
}) {
  const { t } = useTranslation();
  const {
    enabled: summaryEnabled,
    modelId,
    effort,
    updating,
    setEnabled,
    setModel,
    setEffort,
  } = useSummarySettings(searchData);

  const guardSearch = () => {
    if (canSearch === false) {
      message.warning(t('search.chooseDataset'));
      return false;
    }
    return true;
  };

  const handleSubmit = () => {
    if (!guardSearch() || !searchText.trim()) return;
    setIsSearching(!isSearching);
  };

  return (
    <section className="relative w-full flex transition-all justify-center items-center mt-[15vh]">
      <div className="relative z-10 px-8 pt-8 flex  text-transparent flex-col justify-center items-center w-[780px]">
        <RAGFlowLogo showEmbedIcon={showEmbedLogo}></RAGFlowLogo>
        <div className="rounded-lg  text-primary text-xl sticky flex justify-center w-full transform scale-100 mt-8 p-6 min-h-[240px] border">
          {!isSearching && <Spotlight className="z-0 dark:opacity-[0.12]" />}
          <div className="flex flex-col justify-center items-center  w-2/3">
            {!isSearching && (
              <>
                <p className="mb-4 transition-opacity">👋 {t('search.hiThere')}</p>
                <p className="mb-10 transition-opacity">
                  {userInfo && (
                    <>
                      {t('search.welcomeBack')}, {userInfo.nickname}
                    </>
                  )}
                </p>
              </>
            )}

            <PromptInput
              value={searchText}
              onChange={(next) => {
                if (!guardSearch()) return;
                setSearchText(next);
              }}
              onSubmit={handleSubmit}
              placeholder={t('search.searchGreeting')}
              showChips={summaryEnabled}
              summaryEnabled={summaryEnabled}
              onSummaryToggle={setEnabled}
              modelValue={modelId}
              onModelChange={setModel}
              effortValue={effort}
              onEffortChange={setEffort}
              chipsDisabled={updating}
              testId="search-home-input"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
