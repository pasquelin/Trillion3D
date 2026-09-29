// #1237: the world roots' table (docs/FORMAT.md, World super-roots) is read and checked whole, and
// a bundle's pages are viewed on their bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineError } from '../contracts/cache.ts';
import { assertWorldRoots, cellDependencies, worldBundlePages } from './worldRoots.ts';
import { worldPage, worldRootsFixture } from './worldRoots.fixture.ts';

const refused = (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE';

test('a cell holds the bundles past the pinned top its objects need, each once', () => {
  const { table } = worldRootsFixture();
  assert.equal(assertWorldRoots(JSON.parse(JSON.stringify(table))).pinned, 1);
  assert.deepEqual(cellDependencies(table, 0), [1, 3]);
  assert.deepEqual(cellDependencies(table, 1), [2, 3]);
  assert.deepEqual(cellDependencies(table, 2), [], 'the top alone: pinned, never held');
});

test('a table that breaks its contract is refused whole', () => {
  const broken: ((table: ReturnType<typeof worldRootsFixture>['table']) => void)[] = [
    (table) => (table.version = 2),
    (table) => (table.pinned = 0),
    (table) => (table.pinnedTopBytes += 1),
    (table) => (table.bundles[2].offset += 4),
    (table) => (table.payload.bytes -= 1),
    (table) => table.bundles[1].dependencies.push(9),
    (table) => table.cells[0].objects[0].dependencies.push(4),
  ];
  for (const [at, breaks] of broken.entries()) {
    const { table } = worldRootsFixture();
    breaks(table);
    assert.throws(() => assertWorldRoots(table), refused, `breakage ${at}`);
  }
});

test("a bundle's pages are its vertices and local triangles, and nothing else", () => {
  const [page] = worldBundlePages(worldPage(5), 1, 0);
  assert.deepEqual([...page.positions], [5, 0, 0, 6, 0, 0, 5, 1, 0]);
  assert.deepEqual([...page.indices], [0, 1, 2]);
  const both = new Uint8Array([...worldPage(0), ...worldPage(1)]);
  assert.equal(worldBundlePages(both, 2, 0).length, 2);
  assert.throws(() => worldBundlePages(both, 1, 0), refused, 'bytes past its pages');
  assert.throws(() => worldBundlePages(worldPage(0), 2, 0), refused, 'a page past its bytes');
  const wrong = worldPage(0);
  new DataView(wrong.buffer).setUint16(44, 3, true);
  assert.throws(() => worldBundlePages(wrong, 1, 0), refused, 'a vertex it does not carry');
});
