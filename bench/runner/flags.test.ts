// #724: every name a program reads from the harness — flag, campaign run, view, report key — is
// English, by the words `check:english` counts. Read off the source text, never imported: the
// scan fails on a French name itself, whatever the module around it exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frenchWords } from '../../scripts/check-english.ts';

const HERE = import.meta.dirname;
const read = (file: string) => readFileSync(join(HERE, file), 'utf8');

/** How a harness names a flag: read from its map, through a reader taking the name first, as a
 *  side option's key, or written `--name` (help, errors, the campaign's lines). */
const NAMED = [
  /flags\.(?:get|has)\(\s*'([^']+)'/g,
  /\b(?:flag|number|mio|mioSi|triple)\(\s*'([^']+)'/g,
  /side(?:Choice|Flag)\(flags,\s*[\w.]+,\s*'([^']+)'/g,
  /(?<![\w-])--([a-z][\w-]*)/g,
];

/** The harness sources, in every folder of the runner, tests left out: a test may name a retired
 *  flag to prove it refused. */
function harnessSources() {
  return readdirSync(HERE, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => read(file));
}

/** Every capture of `pattern` in `text`, split on commas. */
const captures = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].flatMap(([, name]) => name.split(','));

/** The names of `names` holding a French word. */
const french = (names: Iterable<string>) => [...names].filter((name) => frenchWords(name).length);

test('no flag a harness reads, and no flag of a campaign line, is named in French', () => {
  const names = new Set(
    harnessSources().flatMap((text) => NAMED.flatMap((p) => captures(text, p))),
  );
  // The scan sees the flags, not an empty set: one of each way of naming them.
  for (const known of ['views', 'geometry-pool-live', 'error-metric', 'target', 'from', 'list'])
    assert.ok(names.has(known), known);
  assert.deepEqual(french(names), []);
});

test('no campaign run and no view is named in French', () => {
  const runs = captures(read('campaign.ts'), /^([a-z][\w-]*) \| [^|\n]+ \| /gm);
  const views = [
    ...captures(read('poses.ts'), /^ {2}(\w+): \{ index:/gm),
    ...harnessSources().flatMap((text) => captures(text, /--views[ =]([\w,]+)/g)),
  ];
  for (const known of ['mobile', 'bounce', 'lights-4']) assert.ok(runs.includes(known), known);
  for (const known of ['overview', 'ground', 'street', 'detail'])
    assert.ok(views.includes(known), known);
  assert.deepEqual([...french(runs), ...french(views)], []);
});

/** The files shaping what the harness writes: the report, its settings, the page's reply, the
 *  oracle's report. */
const SHAPES = [
  'report/types.ts',
  'benchSettings.ts',
  'measureOptions.ts',
  'references/oracleView.ts',
  'references/oracleCompare.ts',
];

test('no key of the published report, the page reply or the oracle report is French', () => {
  const keys = SHAPES.flatMap((file) => captures(read(file), /^\s+(\w+)\??: /gm));
  for (const known of ['stageProfile', 'pageBudget', 'witnessLights', 'load', 'error'])
    assert.ok(keys.includes(known), known);
  assert.deepEqual(french(new Set(keys)), []);
});
