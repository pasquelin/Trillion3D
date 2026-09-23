import english from '../../i18n/en.json' with { type: 'json' };
import { LANGUAGE_META } from './languages.inline.ts';
import type { Locale } from '../locale.ts';

/** A language's dictionary: its `meta`, then the portal's words by namespace, English the model. */
export type Dictionary = typeof english;

/** The language every other one is checked against, and the one a missing language falls to. */
export const DEFAULT_LANGUAGE = 'en';

/** What the selector lists: each language's code (its file name) and how it names itself,
 *  English first. */
export const LANGUAGES = [
  DEFAULT_LANGUAGE,
  ...Object.keys(LANGUAGE_META).filter((code) => code !== DEFAULT_LANGUAGE),
].map((code) => ({ code, ...LANGUAGE_META[code] }));

export const isLanguage = (code: string | undefined) =>
  code !== undefined && Object.hasOwn(LANGUAGE_META, code);

/** The dictionaries loaded so far: English, bundled with the portal, and each language read. */
const loaded: Record<Locale, Dictionary> = { [DEFAULT_LANGUAGE]: english };

/** The dictionary of `locale` once `loadDictionary` has read it; English until then. */
export const dictionaryOf = (locale: Locale): Dictionary => loaded[locale] ?? english;

/** Reads the dictionary of `code`, once: in the portal bundle each language is a chunk of its
 *  own, fetched when a page is first shown in it. An unknown language is English. The path is
 *  concatenated, not a template: the bundle lowers templates before it sees the files it names. */
export async function loadDictionary(code: Locale): Promise<Dictionary> {
  if (!isLanguage(code)) return english;
  loaded[code] ??= (await import('../../i18n/' + code + '.json', { with: { type: 'json' } }))
    .default as Dictionary;
  return loaded[code];
}

/** The word `table` gives `key`, when it gives one: a table keyed by ids the code does not fix. */
export const wordFor = (table: Record<string, string>, key: string) =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** The word naming an entry's kind in `locale`: `kind.<kind>`, or the kind itself. */
export const kindName = (kind: string, locale: Locale) =>
  wordFor(dictionaryOf(locale).kind, kind) ?? kind;
