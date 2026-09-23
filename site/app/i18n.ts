import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE, isLanguage } from '../content/i18n/dictionary.ts';
import { DICTIONARIES } from '../content/i18n/languages.inline.ts';
import type { Dictionary } from '../content/i18n/languages.inline.ts';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: Dictionary };
  }
}

/**
 * The portal's words, one i18next instance over every dictionary of `site/i18n/`. The route
 * (`#/<language>/…`) names the language (`parseRoute`, then `useRoute` switches to it); a route
 * that names none takes what this detects: the reader's last choice, then the browser, then
 * English. A language the route names is remembered.
 */
export const i18n = i18next.createInstance();

/** A browser's language as the portal's: its own dictionary, else its language's (`fr-CA` → `fr`),
 *  so a preferred regional variant outranks a less preferred language given exactly. */
const nearestLanguage = (code: string) => (isLanguage(code) ? code : code.split('-')[0]);

void i18n.use(LanguageDetector).init({
  resources: Object.fromEntries(
    Object.entries(DICTIONARIES).map(([code, translation]) => [code, { translation }]),
  ),
  supportedLngs: Object.keys(DICTIONARIES),
  fallbackLng: DEFAULT_LANGUAGE,
  initAsync: false,
  interpolation: { escapeValue: false },
  detection: {
    order: ['localStorage', 'navigator'],
    convertDetectedLanguage: nearestLanguage,
    lookupLocalStorage: 'web-geometry.language',
    caches: ['localStorage'],
  },
});

/** The words of `locale`, outside a component: a menu, a search index. */
export const wordsOf = (locale: string) => i18n.getFixedT(locale);

/** The words of `locale` in a component, which renders again when the words change. */
export const useWords = (locale: string) => useTranslation(undefined, { lng: locale, i18n }).t;
