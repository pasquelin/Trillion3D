import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_LANGUAGE,
  dictionaryOf,
  isLanguage,
  LANGUAGES,
  loadDictionary,
} from '../content/i18n/dictionary.ts';
import type { Dictionary } from '../content/i18n/dictionary.ts';
import type { Locale } from '../content/locale.ts';

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: Dictionary };
  }
}

/**
 * The portal's words, one i18next instance over the dictionaries of `site/i18n/`: English
 * bundled, each other language added once `loadLanguage` has read it. The route
 * (`#/<language>/…`) names the language (`parseRoute`, then `useRoute` switches to it); a route
 * that names none takes what this detects: the reader's last choice, then the browser, then
 * English. A language the route names is remembered.
 */
export const i18n = i18next.createInstance();

/** A browser's language as the portal's: its own dictionary, else its language's (`fr-CA` → `fr`),
 *  so a preferred regional variant outranks a less preferred language given exactly. */
const nearestLanguage = (code: string) => (isLanguage(code) ? code : code.split('-')[0]);

void i18n.use(LanguageDetector).init({
  resources: { [DEFAULT_LANGUAGE]: { translation: dictionaryOf(DEFAULT_LANGUAGE) } },
  supportedLngs: LANGUAGES.map(({ code }) => code),
  fallbackLng: DEFAULT_LANGUAGE,
  initAsync: false,
  interpolation: { escapeValue: false },
  detection: {
    order: ['localStorage', 'navigator'],
    convertDetectedLanguage: nearestLanguage,
    lookupLocalStorage: 'trillion3d.language',
    caches: ['localStorage'],
  },
});

/** The language detected for a route that names none: one the portal has, else English. */
export const detectedLanguage = (): Locale =>
  isLanguage(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;

/** Reads the dictionary of `locale` and gives it to i18next, once; a page in `locale` renders
 *  after it. */
export async function loadLanguage(locale: Locale) {
  // A chunk that cannot be fetched leaves the page on English's words, never a dead link; the
  // next visit to the language fetches it again.
  const dictionary = await loadDictionary(locale).catch(() => null);
  if (dictionary && !i18n.hasResourceBundle(locale, 'translation'))
    i18n.addResourceBundle(locale, 'translation', dictionary);
}

/** The words of `locale`, outside a component: a menu, a search index. */
export const wordsOf = (locale: string) => i18n.getFixedT(locale);

/** The words of `locale` in a component, which renders again when the words change. */
export const useWords = (locale: string) => useTranslation(undefined, { lng: locale, i18n }).t;

/** The address of the example `file` in `locale`: the example's kit reads its words in the
 *  language `?lang=` names (`site/examples/kit/words.ts`). */
export const exampleAddress = (file: string, locale: Locale) => `${file}?lang=${locale}`;
