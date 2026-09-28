// A ratchet on the French left in the code (CONTRIBUTING.md: all wording in English). It counts,
// per package, the words of `scripts/french-words.ts` in the identifiers, comments and strings of
// every tracked source file — each word of a camelCase or snake_case name counts — the strings a
// program reads excepted. A count above `scripts/english-baseline.json` fails; one below is
// written there, to be committed. `pnpm run check:english`; `--write` records today's counts.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRENCH_EXCEPTIONS, FRENCH_WORDS } from './french-words.ts';
import { repositoryFiles } from './repository-files.ts';

const SOURCE = /\.(?:[cm]?ts|tsx|rs|wgsl)$/;
/** The files that hold French words on purpose: the list, and the test that plants them. */
const EXEMPT = new Set(['scripts/french-words.ts', 'scripts/check-english.test.ts']);
const BASELINE = 'scripts/english-baseline.json';

/** The French words of `text`, lower case and without accents, in order of appearance. */
export function frenchWords(text: string): string[] {
  let plain = text;
  for (const literal of Object.keys(FRENCH_EXCEPTIONS)) plain = plain.replaceAll(literal, ' ');
  const words = plain
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .match(/\p{L}+/gu);
  return (words ?? [])
    .map((word) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())
    .filter((word) => FRENCH_WORDS.has(word));
}

/** The package a file belongs to: `packages/<name>`, else its top folder. */
const unitOf = (file: string) =>
  file.startsWith('packages/') ? file.split('/', 2).join('/') : file.split('/')[0];

/** The French words of each file of `files` (path -> text) that has any. */
export function frenchByFile(files: Map<string, string>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, text] of files) {
    if (EXEMPT.has(file)) continue;
    const words = frenchWords(text);
    if (words.length) found.set(file, words);
  }
  return found;
}

/** The number of French words of each package, in name order. */
export function countByUnit(found: Map<string, string[]>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [file, words] of found)
    counts[unitOf(file)] = (counts[unitOf(file)] ?? 0) + words.length;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

/** The packages whose count rose above `baseline` (a package it lacks stands at zero), and
 *  whether any fell below it. */
export function ratchet(baseline: Record<string, number>, counts: Record<string, number>) {
  const units = new Set([...Object.keys(baseline), ...Object.keys(counts)]);
  const risen = [...units].filter((unit) => (counts[unit] ?? 0) > (baseline[unit] ?? 0));
  const fallen = [...units].some((unit) => (counts[unit] ?? 0) < (baseline[unit] ?? 0));
  return { risen, fallen };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const tracked = repositoryFiles(root);
  if (!tracked) throw new Error('Not a Git repository.');
  const found = frenchByFile(
    new Map(
      tracked
        .filter((file) => SOURCE.test(file))
        .map((file): [string, string] => [file, readFileSync(join(root, file), 'utf8')]),
    ),
  );
  const counts = countByUnit(found);
  const path = join(root, BASELINE);
  const write = () => writeFileSync(path, `${JSON.stringify(counts, null, 2)}\n`);
  if (process.argv.includes('--write')) write();
  else {
    const baseline = JSON.parse(readFileSync(path, 'utf8')) as Record<string, number>;
    const { risen, fallen } = ratchet(baseline, counts);
    for (const unit of risen) {
      console.error(`${unit}: ${counts[unit]} French words, ${baseline[unit] ?? 0} allowed:`);
      for (const [file, words] of found)
        if (unitOf(file) === unit) console.error(`  ${file}: ${words.join(', ')}`);
    }
    if (risen.length) process.exitCode = 1;
    else if (fallen) {
      write();
      console.log(`Fewer French words: ${BASELINE} lowered, commit it.`);
    } else console.log('No new French word in the code.');
  }
  console.log(
    `Named exceptions, strings a program reads: ${Object.keys(FRENCH_EXCEPTIONS).join(', ')}`,
  );
}
