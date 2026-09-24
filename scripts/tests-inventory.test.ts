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
    'stale tree: run `node scripts/tests-inventory.ts --write`',
  );
});

test('the tree carries no count and refuses a folder the repository lacks', () => {
  const files = [
    'packages/sdk-core/src/a.test.ts',
    'packages/sdk-browser/src/b.test.ts',
    'packages/sdk-node/src/c.test.ts',
    'tests/integration/d.test.ts',
    'tests/browser/renders/e.browser.ts',
    'tests/browser/probes/f-probe.ts',
    'tests/browser/support/g.ts',
    'tests/kit/h.ts',
    'tests/fixtures/i.ts',
    'bench/core/j.ts',
    'bench/perf/core/k.perf.ts',
    'bench/perf/browser/l.perf.ts',
    'bench/oracles/m.ts',
    'bench/runner/n.ts',
    'bench/witnesses/o.ts',
  ];
  assert.doesNotMatch(renderInventory(files), /\d/);
  assert.throws(() => renderInventory(files.slice(1)), /packages\/sdk-core\/src\//);
});

test('a page without markers is refused, not rewritten', () => {
  assert.throws(() => withInventory('# no block', 'x'), new RegExp(`${BEGIN}.*${END}`));
});
