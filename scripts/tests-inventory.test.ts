import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryFiles } from './repository-files.ts';
import { BEGIN, END, renderInventory, withInventory } from './tests-inventory.ts';

test('docs/TESTS.md carries the tree the repository has', () => {
  const files = repositoryFiles(resolve(import.meta.dirname, '..'));
  assert.ok(files, 'a Git repository');
  const doc = readFileSync(resolve(import.meta.dirname, '../docs/TESTS.md'), 'utf8');
  assert.equal(
    withInventory(doc, renderInventory(files)),
    doc,
    'stale counts: run `node scripts/tests-inventory.ts --write`',
  );
});

test('the counts read the folders they name', () => {
  const inventory = renderInventory([
    'packages/sdk-core/src/math/a.test.ts',
    'packages/sdk-core/src/b.ts',
    'tests/browser/probes/one-probe.ts',
    'tests/browser/probes/support.ts',
    'bench/perf/core/x.perf.ts',
  ]);
  assert.match(inventory, /sdk-core\/src\/\s+1 \*\.test\.ts/);
  assert.match(inventory, /browser\/probes\/\s+1 GPU probes \+ 1 support modules/);
  assert.match(inventory, /perf\/core\/\s+1 \*\.perf\.ts/);
});

test('a page without markers is refused, not rewritten', () => {
  assert.throws(() => withInventory('# no block', 'x'), new RegExp(`${BEGIN}.*${END}`));
});
