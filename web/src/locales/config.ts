import { LanguageAbbreviation } from '@/constants/common';
import storage from '@/utils/authorization-util';
import dayjs from 'dayjs';
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { upperFirst } from 'lodash';
import { initReactI18next } from 'react-i18next';
import translation_en from './en';

//The language is based on the .ng file stored in the client's local storage.
// The language stored in the database is for agent template resources, as these resources reside on the server.
// When a user logs in from a different machine, the login page language is the language configured by VITE_DEFAULT_LANGUAGE_CODE.

const languageImports: Record<string, () => Promise<{ default: any }>> = {
  [LanguageAbbreviation.En]: () => import('./en'),
  [LanguageAbbreviation.Zh]: () => import('./zh'),
  [LanguageAbbreviation.ZhTraditional]: () => import('./zh-traditional'),
  [LanguageAbbreviation.Id]: () => import('./id'),
  [LanguageAbbreviation.Ja]: () => import('./ja'),
  [LanguageAbbreviation.Es]: () => import('./es'),
  [LanguageAbbreviation.Vi]: () => import('./vi'),
  [LanguageAbbreviation.Ru]: () => import('./ru'),
  [LanguageAbbreviation.PtBr]: () => import('./pt-br'),
  [LanguageAbbreviation.De]: () => import('./de'),
  [LanguageAbbreviation.Fr]: () => import('./fr'),
  [LanguageAbbreviation.It]: () => import('./it'),
  [LanguageAbbreviation.Bg]: () => import('./bg'),
  [LanguageAbbreviation.Ar]: () => import('./ar'),
  [LanguageAbbreviation.Tr]: () => import('./tr'),
  [LanguageAbbreviation.Ko]: () => import('./ko'),
};

const supportedLanguageCodes: Intl.UnicodeBCP47LocaleIdentifier[] =
  Object.keys(languageImports);

export const supportedLanguages = supportedLanguageCodes.map((code) => {
  const locale = new Intl.Locale(code);

  return {
    code,
    locale,
    displayName: upperFirst(
      new Intl.DisplayNames(locale, { type: 'language' }).of(code)!,
    ),
  };
});

export const DEFAULT_LANGUAGE_CODE =
  import.meta.env.VITE_DEFAULT_LANGUAGE_CODE || LanguageAbbreviation.En;

const BROWSER_LANGUAGE_ALIASES: Record<string, LanguageAbbreviation> = {
  zh: LanguageAbbreviation.Zh,
  'zh-cn': LanguageAbbreviation.Zh,
  'zh-sg': LanguageAbbreviation.Zh,
  'zh-my': LanguageAbbreviation.Zh,
  'zh-hans': LanguageAbbreviation.Zh,
  'zh-tw': LanguageAbbreviation.ZhTraditional,
  'zh-hk': LanguageAbbreviation.ZhTraditional,
  'zh-mo': LanguageAbbreviation.ZhTraditional,
  'zh-hant': LanguageAbbreviation.ZhTraditional,
  no: LanguageAbbreviation.En,
  nb: LanguageAbbreviation.En,
  nn: LanguageAbbreviation.En,
};

/**
 * Resolve the browser preferred language to one of the supported languages.
 * Matching order: exact locale (e.g. pt-br) -> region-less locale (e.g. pt for
 * pt-BR) -> undefined when the browser language is not supported.
 */
export const detectBrowserLanguage = (): LanguageAbbreviation | undefined => {
  if (typeof navigator === 'undefined') {
    return undefined;
  }

  const candidates =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];

  for (const candidate of candidates) {
    const locale = candidate?.toLowerCase();
    if (!locale) {
      continue;
    }

    // Chinese needs extra care: zh-Hant/zh-TW/zh-HK must map to Traditional,
    // every other Chinese locale (zh, zh-CN, zh-SG, zh-Hans) to Simplified.
    if (locale === 'zh' || locale.startsWith('zh-')) {
      return (
        BROWSER_LANGUAGE_ALIASES[locale] ||
        (/hant|tw|hk|mo/.test(locale)
          ? LanguageAbbreviation.ZhTraditional
          : LanguageAbbreviation.Zh)
      );
    }

    const alias = BROWSER_LANGUAGE_ALIASES[locale];
    if (alias) {
      return alias;
    }

    const exact = supportedLanguageCodes.find(
      (code) => code.toLowerCase() === locale,
    );
    if (exact) {
      return exact as LanguageAbbreviation;
    }

    const base = locale.split('-')[0];
    const byBase = supportedLanguageCodes.find(
      (code) => code.toLowerCase().split('-')[0] === base,
    );
    if (byBase) {
      return byBase as LanguageAbbreviation;
    }
  }

  return undefined;
};

const resources = {
  [LanguageAbbreviation.En]: translation_en,
};

const updateDocumentLocale = (lng: string) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = 'ltr';
  dayjs.locale(lng === 'zh' ? 'zh-cn' : lng);
};

i18n
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    detection: {
      lookupLocalStorage: 'lng',
      order: ['localStorage'],
      caches: [],
    },
    supportedLngs: supportedLanguageCodes,
    resources,
    fallbackLng: DEFAULT_LANGUAGE_CODE,
    interpolation: {
      escapeValue: false,
    },
  });

export const loadLanguageAsync = async (lng: string): Promise<void> => {
  const normalizedLng = lng;

  if (i18n.hasResourceBundle(normalizedLng, 'translation')) {
    return;
  }

  const importFn = languageImports[normalizedLng];
  if (!importFn) {
    console.warn(`Language ${lng} is not supported for lazy loading`);
    return;
  }

  try {
    const module = await importFn();
    const translationData = module.default?.translation || module.default;
    i18n.addResourceBundle(normalizedLng, 'translation', translationData);
  } catch (error) {
    console.error(`Failed to load language ${lng}:`, error);
  }
};

export const changeLanguageAsync = async (
  lng: string,
  options: { persist?: boolean } = {},
): Promise<void> => {
  const { persist = true } = options;
  const normalizedLng = lng;

  if (
    normalizedLng !== LanguageAbbreviation.En &&
    !i18n.hasResourceBundle(normalizedLng, 'translation')
  ) {
    await loadLanguageAsync(normalizedLng);
  }

  if (persist) {
    storage.setLanguage(lng);
  }

  updateDocumentLocale(lng);

  await i18n.changeLanguage(normalizedLng);
};

export const initLanguage = async (): Promise<void> => {
  const storedLng = storage.getLanguage();
  // An explicit user choice always wins; otherwise follow the browser language
  // so that a Chinese browser opens the app in Chinese out of the box.
  const currentLng = storedLng || detectBrowserLanguage() || DEFAULT_LANGUAGE_CODE;

  await changeLanguageAsync(currentLng, { persist: !!storedLng });
};

export default i18n;
