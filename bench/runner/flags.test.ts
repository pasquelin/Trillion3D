// #724: every flag a harness reads or writes is English, by the words `check:english` counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frenchWords } from '../../scripts/check-english.ts';
import { BASE, CAMPAIGN } from './campaign.ts';

/** How a harness names a flag: read from its map, through a reader taking the name first, as a
 *  side option's key, or written `--name` (help, errors, the campaign's lines). */
const NAMED = [
  /flags\.(?:get|has)\(\s*'([^']+)'/g,
  /\b(?:flag|number|mio|mioSi|triple)\(\s*'([^']+)'/g,
  /side(?:Choice|Flag)\(flags,\s*[\w.]+,\s*'([^']+)'/g,
  /(?<![\w-])--([a-z][\w-]*)/g,
];

/** The harness sources, tests left out: a test may name a retired flag to prove it refused. */
function harnessSources() {
  const dirs = [import.meta.dirname, join(import.meta.dirname, 'scenes')];
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => readFileSync(join(dir, file), 'utf8')),
  );
}

test('no flag a harness reads, and no campaign line, is named in French', () => {
  const names = new Set<string>();
  for (const text of harnessSources())
    for (const pattern of NAMED) for (const [, name] of text.matchAll(pattern)) names.add(name);
  for (const [, , args] of CAMPAIGN)
    for (const arg of [...BASE.split(' '), ...args])
      if (arg.startsWith('--')) names.add(arg.slice(2));
  // The scan sees the flags, not an empty set: one of each way of naming them.
  for (const known of ['views', 'geometry-pool-live', 'error-metric', 'target', 'from', 'list'])
    assert.ok(names.has(known), known);
  const french = [...names].filter((name) => frenchWords(name).length);
  assert.deepEqual(french, []);
});
