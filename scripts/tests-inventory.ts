// The test and benchmark tree of `docs/TESTS.md` § 1, counted from the repository rather than
// written by hand: `node scripts/tests-inventory.ts --write` renders the block between its markers,
// and `scripts/tests-inventory.test.ts` fails when the page and the tree disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.ts';

export const BEGIN = '<!-- tests-inventory:begin -->';
export const END = '<!-- tests-inventory:end -->';
const ROOT = resolve(import.meta.dirname, '..');
const DOC = join(ROOT, 'docs/TESTS.md');

/** How many of `files` sit directly in `dir` and match `name`. */
function count(files: string[], dir: string, name: RegExp): number {
  return files.filter((file) => {
    if (!file.startsWith(dir + '/')) return false;
    const rest = file.slice(dir.length + 1);
    return !rest.includes('/') && name.test(rest);
  }).length;
}

/** How many of `files` sit anywhere under `dir` and match `name`. */
function countDeep(files: string[], dir: string, name: RegExp): number {
  return files.filter((file) => file.startsWith(dir + '/') && name.test(file)).length;
}

const TEST = /\.test\.m?ts$/;
const TS = /\.m?ts$/;

/** The tree, one line per folder, each count read from `files`. */
export function renderInventory(files: string[]): string {
  const probes = count(files, 'tests/browser/probes', /-.*\.ts$/);
  const probeSupport = count(files, 'tests/browser/probes', /^[^-]*\.ts$/);
  const lines = [
    'packages/',
    `  sdk-core/src/       ${countDeep(files, 'packages/sdk-core/src', TEST)} *.test.ts — unit tests, next to their source`,
    `  sdk-browser/src/    ${countDeep(files, 'packages/sdk-browser/src', TEST)} *.test.ts`,
    `  sdk-node/src/       ${countDeep(files, 'packages/sdk-node/src', TEST)} *.test.ts`,
    'tests/',
    `  integration/        ${count(files, 'tests/integration', TEST)} *.test.ts — architecture, boundaries, public contracts`,
    `  browser/renders/    ${count(files, 'tests/browser/renders', /\.browser\.ts$/)} *.browser.ts — rendering in real Chromium`,
    `  browser/probes/     ${probes} GPU probes + ${probeSupport} support modules`,
    `  browser/support/    ${count(files, 'tests/browser/support', TS)} pages and cases served to the render proofs`,
    `  kit/                ${countDeep(files, 'tests/kit', TS)} shared test tools: fake GPU devices, servers, assertions`,
    `  fixtures/           ${count(files, 'tests/fixtures', TS)} test data builders; formats/ holds the compiler goldens`,
    'bench/',
    `  core/               ${count(files, 'bench/core', TS)} modules: measure, report, diff, ulp, baseline`,
    `  perf/core/          ${count(files, 'bench/perf/core', /\.perf\.ts$/)} *.perf.ts`,
    `  perf/browser/       ${count(files, 'bench/perf/browser', /\.perf\.ts$/)} *.perf.ts + ${count(files, 'bench/perf/browser/support', TS)} support modules`,
    `  oracles/            ${countDeep(files, 'bench/oracles', TS)} reference implementations, copied verbatim`,
    `  runner/             ${countDeep(files, 'bench/runner', TS)} modules: the measurement harness (README)`,
    `  witnesses/          ${countDeep(files, 'bench/witnesses', TS)} modules: the host-library witnesses, never published`,
  ];
  return ['```', ...lines, '```'].join('\n');
}

/** `text` with the block between the markers replaced by `inventory`. */
export function withInventory(text: string, inventory: string): string {
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begin === -1 || end < begin) throw new Error(`docs/TESTS.md has no ${BEGIN} … ${END} block`);
  return `${text.slice(0, begin + BEGIN.length)}\n${inventory}\n${text.slice(end)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = repositoryFiles(ROOT);
  if (!files) throw new Error('Not a Git repository.');
  const next = withInventory(readFileSync(DOC, 'utf8'), renderInventory(files));
  if (process.argv.includes('--write')) writeFileSync(DOC, next);
  else process.stdout.write(renderInventory(files) + '\n');
}
