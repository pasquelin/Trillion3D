// A translation left behind by its English: `check:i18n` holds every language to English's keys,
// this gate to its text. `site/content/i18n/translation-sources.json` records, for each entry —
// a portal section's key, an example, a reference entry — the hash of its English and of each
// language's translation. An entry whose English changed while a language's translation did not
// fails; a record that no longer matches the text fails too, until `--write` records it, which it
// refuses while a translation is left behind. `pnpm run check:translations`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import generated from '../site/content/reference/api.json' with { type: 'json' };
import { DEFAULT_LANGUAGE } from '../site/content/i18n/dictionary.ts';
import type { PortalEntry } from '../site/content/model.ts';
import {
  DICTIONARIES,
  EXAMPLE_WORDS,
  REFERENCE_TRANSLATIONS,
  englishReferenceTexts,
} from './i18n-keys.ts';

/** Each entry's hash, by entry then by language: `{ 'examples:water': { en: 'a1b2c3d4' } }`. */
type Hashes = Record<string, Record<string, string>>;

const RECORD = new URL('../site/content/i18n/translation-sources.json', import.meta.url);

/** A short hash of an entry's text, `-` for an entry a language lacks. */
export const hashOf = (value: unknown) =>
  value === undefined
    ? '-'
    : createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 8);

/** The entries of one language: `(entry, text)` for each. */
function entriesOf(code: string): [string, unknown][] {
  const portal = Object.entries(DICTIONARIES[code] as Record<string, unknown>)
    .filter(([section]) => section !== 'meta')
    .flatMap(([section, words]): [string, unknown][] =>
      words && typeof words === 'object'
        ? Object.entries(words).map(([key, text]) => [`portal:${section}.${key}`, text])
        : [[`portal:${section}`, words]],
    );
  const examples = Object.entries(EXAMPLE_WORDS[code] ?? {}).map(
    ([id, words]): [string, unknown] => [`examples:${id}`, words],
  );
  const reference = (generated as PortalEntry[]).map((entry): [string, unknown] => [
    `reference:${entry.id}`,
    code === DEFAULT_LANGUAGE
      ? Object.fromEntries(englishReferenceTexts(entry))
      : REFERENCE_TRANSLATIONS[code]?.[entry.id],
  ]);
  return [...portal, ...examples, ...reference];
}

/** The hashes of today's text: every English entry, in every language. */
export function currentHashes(): Hashes {
  const languages = Object.keys(DICTIONARIES);
  const texts = new Map(languages.map((code) => [code, new Map(entriesOf(code))]));
  return Object.fromEntries(
    [...texts.get(DEFAULT_LANGUAGE)!.keys()].map((entry) => [
      entry,
      Object.fromEntries(languages.map((code) => [code, hashOf(texts.get(code)!.get(entry))])),
    ]),
  );
}

/** `language entry` for each translation whose English changed since `recorded` and which did
 *  not; an entry or a language the record lacks is new, never behind. */
export function staleTranslations(recorded: Hashes, current: Hashes): string[] {
  return Object.entries(current).flatMap(([entry, now]) => {
    const then = recorded[entry];
    if (!then || then[DEFAULT_LANGUAGE] === now[DEFAULT_LANGUAGE]) return [];
    return Object.keys(now)
      .filter((code) => code !== DEFAULT_LANGUAGE && now[code] !== '-' && now[code] === then[code])
      .map((code) => `${code} ${entry}`);
  });
}

/** The record's text: one line per entry, its hashes in the order of `languages`. */
export function serialise(hashes: Hashes): string {
  const languages = Object.keys(Object.values(hashes)[0] ?? {});
  const lines = Object.entries(hashes).map(
    ([entry, byLanguage]) =>
      `    ${JSON.stringify(entry)}: "${Object.values(byLanguage).join(' ')}"`,
  );
  return `{\n  "languages": "${languages.join(' ')}",\n  "entries": {\n${lines.join(',\n')}\n  }\n}\n`;
}

/** The hashes a record's text holds. */
export function parse(text: string): Hashes {
  const { languages, entries } = JSON.parse(text) as {
    languages: string;
    entries: Record<string, string>;
  };
  const codes = languages.split(' ');
  return Object.fromEntries(
    Object.entries(entries).map(([entry, line]) => [
      entry,
      Object.fromEntries(line.split(' ').map((hash, index) => [codes[index], hash])),
    ]),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = currentHashes();
  // No record yet: every entry is new, and `--write` records the first one.
  const text = existsSync(RECORD) ? readFileSync(RECORD, 'utf8') : '';
  const stale = staleTranslations(text ? parse(text) : {}, current);
  if (stale.length) {
    console.error(`English changed, these translations did not:\n  ${stale.join('\n  ')}`);
    process.exitCode = 1;
  } else if (process.argv.includes('--write')) writeFileSync(RECORD, serialise(current));
  else if (text !== serialise(current)) {
    console.error('The translation record is out of date: `pnpm run check:translations --write`.');
    process.exitCode = 1;
  } else console.log('Every translation follows its English.');
}
