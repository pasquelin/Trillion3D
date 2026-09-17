import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedTests } from './check-changed.mjs';

test('selects tests through transitive imports and does not select unrelated suites', () => {
  const files = new Map([
    ['packages/sdk-core/leaf.ts', 'export const leaf = 1;'],
    ['packages/sdk-core/index.ts', "export {leaf} from './leaf.ts';"],
    ['packages/sdk-core/leaf.test.ts', "import {leaf} from './index.ts';"],
    ['packages/sdk-browser/view.test.ts', "import {view} from './view.ts';"],
    ['packages/sdk-browser/view.ts', 'export const view = 2;'],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['packages/sdk-core/leaf.ts'])), [
    'packages/sdk-core/leaf.test.ts',
  ]);
});

test('includes a changed test even when it has no source imports', () => {
  const files = new Map([
    [
      'test/integration/contrat-public.test.mjs',
      "import test from 'node:test'; test('ok',()=>{});",
    ],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['test/integration/contrat-public.test.mjs'])), [
    'test/integration/contrat-public.test.mjs',
  ]);
});

test('selects a test when an imported source file was deleted', () => {
  const files = new Map([['packages/sdk-core/index.test.ts', "import {old} from './old.ts';"]]);
  assert.deepEqual(relatedTests(files, new Set(['packages/sdk-core/old.ts'])), [
    'packages/sdk-core/index.test.ts',
  ]);
});
