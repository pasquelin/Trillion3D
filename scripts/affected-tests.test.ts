import test from 'node:test';
import assert from 'node:assert/strict';
import { AGGREGATOR_IMPORTS, domainOf, relatedTests } from './affected-tests.ts';

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
    ['tests/integration/public.test.ts', "import {api} from 'trillion3d';"],
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

test('a test or bench file change also runs the inventory of docs/TESTS.md', () => {
  const files = new Map([
    ['scripts/tests-inventory.test.ts', "import './tests-inventory.ts';"],
    ['scripts/tests-inventory.ts', ''],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['bench/perf/core/new.perf.ts'])), [
    'scripts/tests-inventory.test.ts',
  ]);
  assert.deepEqual(relatedTests(files, new Set(['packages/sdk-core/src/leaf.ts'])), []);
});

test('a named import through a barrel reaches the file that defines the name, not its siblings', () => {
  const files = new Map([
    ['packages/sdk-core/src/index.ts', "export * from './light/index.ts';"],
    [
      'packages/sdk-core/src/light/index.ts',
      "export { sun } from './sun.ts';\nexport * from './lamp.ts';",
    ],
    ['packages/sdk-core/src/light/sun.ts', 'export const sun = 1;'],
    ['packages/sdk-core/src/light/lamp.ts', 'export function lamp() {}'],
    [
      'packages/sdk-browser/src/draw/sun.ts',
      "import { sun } from '../../../sdk-core/src/index.ts';\nexport const draw = sun;",
    ],
    ['packages/sdk-browser/src/draw/sun.test.ts', "import { draw } from './sun.ts';"],
    [
      'tests/integration/lamp.test.ts',
      "import { lamp } from '../../packages/sdk-core/src/index.ts';",
    ],
    [
      'tests/integration/all.test.ts',
      "import * as core from '../../packages/sdk-core/src/index.ts';",
    ],
  ]);
  const select = (file: string): string[] => relatedTests(files, new Set([file]));
  assert.deepEqual(select('packages/sdk-core/src/light/sun.ts'), [
    'packages/sdk-browser/src/draw/sun.test.ts',
    'tests/integration/all.test.ts',
  ]);
  assert.deepEqual(select('packages/sdk-core/src/light/lamp.ts'), [
    'tests/integration/all.test.ts',
    'tests/integration/lamp.test.ts',
  ]);
  // The barrel itself: its direct importers, not what they import it for.
  assert.deepEqual(select('packages/sdk-core/src/index.ts'), [
    'packages/sdk-browser/src/draw/sun.test.ts',
    'tests/integration/all.test.ts',
    'tests/integration/lamp.test.ts',
  ]);
});

test('a type-only import runs no code and selects nothing', () => {
  const files = new Map([
    ['scripts/shape.ts', 'export interface Shape { size: number }\nexport const unit = 1;'],
    ['scripts/a.test.ts', "import type { Shape } from './shape.ts';"],
    ['scripts/b.test.ts', "import { type Shape } from './shape.ts';"],
    ['scripts/c.test.ts', "export type { Shape } from './shape.ts';"],
    ['scripts/d.test.ts', "const s: import('./shape.ts').Shape = { size: 1 };"],
    ['scripts/e.test.ts', "import { unit, type Shape } from './shape.ts';"],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['scripts/shape.ts'])), ['scripts/e.test.ts']);
});

test('a chain passes an aggregator only from a file it imports itself', () => {
  const parts = Array.from({ length: AGGREGATOR_IMPORTS }, (_, i) => `scripts/part${i}.ts`);
  const files = new Map<string, string>([
    ...parts.map((part): [string, string] => [part, 'export const x = 1;']),
    ['scripts/leaf.ts', 'export const leaf = 1;'],
    ['scripts/part0.ts', "import { leaf } from './leaf.ts';\nexport const x = leaf;"],
    [
      'scripts/renderer.ts',
      parts.map((part, i) => `import { x as x${i} } from './${part.slice(8)}';`).join('\n'),
    ],
    ['scripts/renderer.test.ts', "import './renderer.ts';"],
    ['scripts/part0.test.ts', "import { x } from './part0.ts';"],
  ]);
  const select = (file: string): string[] => relatedTests(files, new Set([file]));
  assert.deepEqual(select('scripts/part0.ts'), [
    'scripts/part0.test.ts',
    'scripts/renderer.test.ts',
  ]);
  assert.deepEqual(select('scripts/leaf.ts'), ['scripts/part0.test.ts']);
});

test('the tests of the domain folder of a changed file run, whatever they import', () => {
  const files = new Map([
    ['packages/sdk-browser/src/webgpu/shadow/pass.ts', 'export const pass = 1;'],
    ['packages/sdk-browser/src/webgpu/shadow/atlas/atlas.test.ts', ''],
    ['packages/sdk-browser/src/webgpu/pages/pages.test.ts', ''],
    ['packages/sdk-core/src/index.test.ts', ''],
  ]);
  assert.deepEqual(
    domainOf('packages/sdk-browser/src/webgpu/shadow/pass.ts'),
    'packages/sdk-browser/src/webgpu/shadow/',
  );
  assert.equal(domainOf('packages/sdk-core/src/index.ts'), undefined);
  assert.deepEqual(
    relatedTests(files, new Set(['packages/sdk-browser/src/webgpu/shadow/pass.ts'])),
    ['packages/sdk-browser/src/webgpu/shadow/atlas/atlas.test.ts'],
  );
});

test('a barrel that defines names from what it imports passes a change on to its importers', () => {
  const files = new Map([
    [
      'packages/a/src/x/y/index.ts',
      "import { M } from './m.ts';\nexport const make = () => new M();",
    ],
    ['packages/a/src/x/y/m.ts', 'export class M {}'],
    ['packages/b/src/make.test.ts', "import { make } from '../../a/src/x/y/index.ts';"],
  ]);
  assert.deepEqual(relatedTests(files, new Set(['packages/a/src/x/y/m.ts'])), [
    'packages/b/src/make.test.ts',
  ]);
});
