import { DICTIONARIES } from './languages.inline.ts';
import type { Dictionary } from './languages.inline.ts';
import type { Locale, Localized } from '../locale.ts';

/** The language every other one is checked against, and the one a missing language falls to. */
export const DEFAULT_LANGUAGE = 'en';

/** What the selector lists: each language's code (its file name) and how it names itself,
 *  English first. */
export const LANGUAGES = [
  DEFAULT_LANGUAGE,
  ...Object.keys(DICTIONARIES).filter((code) => code !== DEFAULT_LANGUAGE),
].map((code) => ({ code, ...DICTIONARIES[code].meta }));

export const isLanguage = (code: string | undefined) =>
  code !== undefined && Object.hasOwn(DICTIONARIES, code);

export const dictionaryOf = (locale: Locale): Dictionary =>
  isLanguage(locale) ? DICTIONARIES[locale] : DICTIONARIES[DEFAULT_LANGUAGE];

/** One text in every language, as `read` finds it in each dictionary. */
export const localized = (read: (dictionary: Dictionary) => string) =>
  Object.fromEntries(
    Object.entries(DICTIONARIES).map(([code, dictionary]) => [code, read(dictionary)]),
  ) as Localized;

/** The word `table` gives `key`, when it gives one: a table keyed by ids the code does not fix. */
export const wordFor = (table: Record<string, string>, key: string) =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** The word naming an entry's kind in `locale`: `kind.<kind>`, or the kind itself. */
export const kindName = (kind: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).kind, kind) ?? kind;
