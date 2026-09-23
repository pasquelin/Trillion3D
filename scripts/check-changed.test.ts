import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedTests } from './check-changed.ts';

test('selects tests through transitive imports and does not select unrelated suites', () => {
  const files = new Map([
    ['packages/sdk-core/src/leaf.ts', 'export const leaf = 1;'],
    ['packages/sdk-core/src/index.ts', "export {leaf} from './leaf.ts';"],
    ['packages/sdk-core/src/leaf.test.ts', "import {leaf} from './index.ts';"],
    ['packages/sdk-browser/src/view.test.ts', "import {view} from './view.ts';"],
    ['packages/sdk-browser/src/view.ts', 'export const view = 2;'],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['packages/sdk-core/src/leaf.ts'])), [
    'packages/sdk-core/src/leaf.test.ts',
  ]);
});

test('includes a changed test even when it has no source imports', () => {
  const files = new Map([
    [
      'tests/integration/public-contract.test.ts',
      "import test from 'node:test'; test('ok',()=>{});",
    ],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['tests/integration/public-contract.test.ts'])), [
    'tests/integration/public-contract.test.ts',
  ]);
});

test('selects a test when an imported source file was deleted', () => {
  const files = new Map([['packages/sdk-core/src/index.test.ts', "import {old} from './old.ts';"]]);
  assert.deepEqual(relatedTests(files, new Set(['packages/sdk-core/src/old.ts'])), [
    'packages/sdk-core/src/index.test.ts',
  ]);
});

test('the public facade conservatively follows common, browser, and Node changes', () => {
  const files = new Map([
    ['tests/integration/public.test.ts', "import {api} from 'web-geometry';"],
    ['packages/sdk/index.ts', "export {api} from './common/api.ts';"],
    ['packages/sdk/browser.ts', "export {api} from './browser/api.ts';"],
    ['packages/sdk/node.mts', "export {api} from './node/api.mts';"],
    ['packages/sdk/common/api.ts', 'export const api = 1;'],
    ['packages/sdk/browser/api.ts', 'export const api = 1;'],
    ['packages/sdk/node/api.mts', 'export const api = 1;'],
  ]);
  for (const changed of [
    'packages/sdk/common/api.ts',
    'packages/sdk/browser/api.ts',
    'packages/sdk/node/api.mts',
  ])
    assert.deepEqual(relatedTests(files, new Set([changed])), ['tests/integration/public.test.ts']);
});
