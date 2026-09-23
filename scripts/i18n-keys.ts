// The key parity of the portal's languages: each dictionary of `site/i18n/` gives exactly the keys
// the English one gives, and each other language translates exactly the text of the generated API
// reference that English shows (`site/content/reference/api.<language>.json`). A key given on one
// side only is a page that would show a raw key, or a word nothing reads.
import generated from '../site/content/reference/api.json' with { type: 'json' };
import { DEFAULT_LANGUAGE } from '../site/content/i18n/dictionary.ts';
import { DICTIONARIES } from '../site/content/i18n/languages.inline.ts';
import { referenceKeys } from '../site/content/reference/translate.ts';
import { REFERENCE_TRANSLATIONS } from '../site/content/reference/translations.inline.ts';
import type { PortalEntry } from '../site/content/model.ts';

/** One file whose keys differ from English's, and how. */
export interface KeyMismatch {
  file: string;
  missing: string[];
  extra: string[];
}

/** The leaf keys of a JSON value, `a.b.0`: what a translation must give, whatever its words. */
export function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** `actual` against `expected`: the keys one gives and the other does not, if any. */
export function compareKeys(file: string, expected: string[], actual: string[]): KeyMismatch[] {
  const wanted = new Set(expected);
  const given = new Set(actual);
  const missing = expected.filter((key) => !given.has(key));
  const extra = actual.filter((key) => !wanted.has(key));
  return missing.length || extra.length ? [{ file, missing, extra }] : [];
}

/** Every text English shows of the generated reference, `<id>.<key>`, that a written note of
 *  the English dictionary does not replace. */
function englishReferenceKeys(): string[] {
  const written: Record<string, object | undefined> = DICTIONARIES[DEFAULT_LANGUAGE].written;
  return (generated as PortalEntry[]).flatMap((entry) =>
    referenceKeys(entry, written[entry.id]).map((key) => `${entry.id}.${key}`),
  );
}

/** Every file of a language whose keys are not English's: none when the languages agree. */
export function keyMismatches(): KeyMismatch[] {
  const english = leafKeys(DICTIONARIES[DEFAULT_LANGUAGE]);
  const reference = englishReferenceKeys();
  const languages = Object.keys(DICTIONARIES);
  return [
    ...languages.flatMap((code) => [
      ...compareKeys(`site/i18n/${code}.json`, english, leafKeys(DICTIONARIES[code])),
      ...(code === DEFAULT_LANGUAGE
        ? []
        : compareKeys(
            `site/content/reference/api.${code}.json`,
            reference,
            leafKeys(REFERENCE_TRANSLATIONS[code] ?? {}),
          )),
    ]),
    ...Object.keys(REFERENCE_TRANSLATIONS)
      .filter((code) => !languages.includes(code))
      .map((code) => ({
        file: `site/content/reference/api.${code}.json`,
        missing: [`site/i18n/${code}.json`],
        extra: [],
      })),
  ];
}

/** The report of `mismatches`, one file per paragraph, each key named. */
export const describeMismatches = (mismatches: KeyMismatch[]) =>
  mismatches
    .map(({ file, missing, extra }) =>
      [
        `${file} differs from English:`,
        ...missing.map((key) => `  missing ${key}`),
        ...extra.map((key) => `  extra   ${key}`),
      ].join('\n'),
    )
    .join('\n');
