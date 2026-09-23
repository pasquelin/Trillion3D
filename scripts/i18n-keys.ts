// The key parity of the portal's languages: each dictionary of `site/i18n/` gives exactly the keys
// the English one gives, each other language translates exactly the text of the generated API
// reference that English shows (`site/content/reference/api.<language>.json`), and each gives
// the examples' words (`site/examples/i18n/<language>.json`) with English's keys and `{blanks}`.
// A key given on one side only is a page that would show a raw key, or a word nothing reads.
import generated from '../site/content/reference/api.json' with { type: 'json' };
import { DEFAULT_LANGUAGE } from '../site/content/i18n/dictionary.ts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FLAG_SOURCE } from './docs/build-flags.ts';
import { readJsonFolder } from '../site/content/i18n/jsonFolder.ts';
import { referenceKeys } from '../site/content/reference/translate.ts';
import type { Dictionary } from '../site/content/i18n/dictionary.ts';
import type { PortalEntry } from '../site/content/model.ts';
import type { ReferenceText } from '../site/content/reference/translate.ts';

/** Every dictionary of `site/i18n/` and every translation of the reference, by language code. */
const DICTIONARIES = readJsonFolder<Dictionary>(
  new URL('../site/i18n/', import.meta.url),
  /^(.+)\.json$/,
);
const REFERENCE_TRANSLATIONS = readJsonFolder<Record<string, ReferenceText>>(
  new URL('../site/content/reference/', import.meta.url),
  /^api\.(.+)\.json$/,
);

/** The examples' words (`site/examples/kit/words.ts`), by language code. */
const EXAMPLE_WORDS = readJsonFolder<object>(
  new URL('../site/examples/i18n/', import.meta.url),
  /^(.+)\.json$/,
);

/** One file whose keys differ from English's, and how. */
interface KeyMismatch {
  file: string;
  missing: string[];
  extra: string[];
}

/** The leaf keys of a JSON value, `a.b.0`: what a translation must give, whatever its words;
 *  each followed by what `describe` says of its text. */
function leafKeys(
  value: unknown,
  prefix = '',
  describe: (text: unknown) => string = () => '',
): string[] {
  if (value === null || typeof value !== 'object') return [prefix + describe(value)];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key, describe),
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

/** A language's `meta.flag` must name a flag the site build can serve: an SVG of `flag-icons`. */
const flagMismatch = (code: string): KeyMismatch[] => {
  const flag: unknown = DICTIONARIES[code].meta.flag;
  return typeof flag === 'string' && existsSync(resolve(FLAG_SOURCE, `${flag}.svg`))
    ? []
    : [
        {
          file: `site/i18n/${code}.json`,
          missing: [`meta.flag (no flag "${String(flag)}")`],
          extra: [],
        },
      ];
};

/** The `{blanks}` of a text in name order, whatever order a language writes them in: ` {m} {n}`. */
const blanks = (text: unknown) =>
  [...String(text).matchAll(/\{\w+\}/g)]
    .map(([blank]) => ` ${blank}`)
    .sort()
    .join('');

/** The examples' dictionary of `code` against English's: its keys, and the blanks of each word. */
function exampleMismatch(code: string, english: string[]): KeyMismatch[] {
  const file = `site/examples/i18n/${code}.json`;
  const given = EXAMPLE_WORDS[code];
  if (!given) return [{ file, missing: [file], extra: [] }];
  return compareKeys(file, english, leafKeys(given, '', blanks));
}

/** Every file of a language whose keys are not English's, or whose flag is not served: none
 *  when the languages agree. */
export function keyMismatches(): KeyMismatch[] {
  const english = leafKeys(DICTIONARIES[DEFAULT_LANGUAGE]);
  const reference = englishReferenceKeys();
  const examples = leafKeys(EXAMPLE_WORDS[DEFAULT_LANGUAGE], '', blanks);
  const languages = Object.keys(DICTIONARIES);
  return [
    ...languages.flatMap((code) => [
      ...flagMismatch(code),
      ...exampleMismatch(code, examples),
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
