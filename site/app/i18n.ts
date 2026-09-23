import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE } from '../content/i18n/dictionary.ts';
import { DICTIONARIES } from '../content/i18n/languages.inline.ts';
import type { Dictionary } from '../content/i18n/languages.inline.ts';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: Dictionary };
  }
}

/**
 * The portal's words, one i18next instance over every dictionary of `site/i18n/`. The language
 * comes from the route (`#/<language>/…`), then the reader's last choice, then the browser, then
 * English; a route that names one remembers it.
 */
export const i18n = i18next.createInstance();

void i18n.use(LanguageDetector).init({
  resources: Object.fromEntries(
    Object.entries(DICTIONARIES).map(([code, translation]) => [code, { translation }]),
  ),
  supportedLngs: Object.keys(DICTIONARIES),
  fallbackLng: DEFAULT_LANGUAGE,
  nonExplicitSupportedLngs: true,
  load: 'languageOnly',
  initAsync: false,
  interpolation: { escapeValue: false },
  detection: {
    order: ['hash', 'localStorage', 'navigator'],
    lookupFromHashIndex: 0,
    lookupLocalStorage: 'web-geometry.language',
    caches: ['localStorage'],
  },
});

/** The words of `locale`, outside a component: a menu, a search index. */
export const wordsOf = (locale: string) => i18n.getFixedT(locale);

/** The words of `locale` in a component, which renders again when the words change. */
export const useWords = (locale: string) => useTranslation(undefined, { lng: locale, i18n }).t;
