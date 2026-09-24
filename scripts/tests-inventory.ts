// The test and benchmark tree of `docs/TESTS.md` § 1, checked against the repository rather than
// trusted by hand: `node scripts/tests-inventory.ts --write` renders the block between its markers,
// and `scripts/tests-inventory.test.ts` fails when the page and the tree disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.ts';

export const BEGIN = '<!-- tests-inventory:begin -->';
export const END = '<!-- tests-inventory:end -->';
const ROOT = resolve(import.meta.dirname, '..');
const DOC = join(ROOT, 'docs/TESTS.md');

/** Each test folder and what it holds, in the order the page lists them. Counts are left out on
 * purpose: they changed with every pull request and made parallel ones conflict (#452). */
const TREE: readonly (readonly [string, string])[] = [
  ['packages/sdk-core/src', 'unit tests (*.test.ts), next to their source'],
  ['packages/sdk-browser/src', 'unit tests (*.test.ts), next to their source'],
  ['packages/sdk-node/src', 'unit tests (*.test.ts), next to their source'],
  ['tests/integration', 'architecture, boundaries, public contracts (*.test.ts)'],
  ['tests/browser/renders', 'rendering in real Chromium (*.browser.ts)'],
  ['tests/browser/probes', 'GPU probes and their support modules'],
  ['tests/browser/support', 'pages and cases served to the render proofs'],
  ['tests/kit', 'shared test tools: fake GPU devices, servers, assertions'],
  ['tests/fixtures', 'test data builders; formats/ holds the compiler goldens'],
  ['bench/core', 'measure, report, diff, ulp, baseline'],
  ['bench/perf/core', 'CPU benchmarks (*.perf.ts)'],
  ['bench/perf/browser', 'browser benchmarks (*.perf.ts) and their support modules'],
  ['bench/oracles', 'reference implementations, copied verbatim'],
  ['bench/runner', 'the measurement harness (README)'],
  ['bench/witnesses', 'the host-library witnesses, never published'],
];

/** The tree, one line per folder; a folder the repository no longer has is refused. */
export function renderInventory(files: string[]): string {
  const lines = TREE.map(([dir, what]) => {
    if (!files.some((file) => file.startsWith(dir + '/'))) {
      throw new Error(`docs/TESTS.md names ${dir}/, which the repository no longer has`);
    }
    return `${(dir + '/').padEnd(28)} ${what}`;
  });
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
