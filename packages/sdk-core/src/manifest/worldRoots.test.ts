// #1237: a placed cell holds the world bundles its objects need, and a bundle's pages are viewed on
// their bytes. The table's records are read in `worldRootsTable.test.ts` (#1232).
import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../contracts/cache.ts'
import { cellDependencies, worldBundlePages } from './worldRoots.ts'
import { worldPage, worldRootsFixture } from './worldRoots.fixture.ts'

const refused = (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE'

test('a cell holds the bundles past the pinned top its objects need, each once', () => {
  const { table } = worldRootsFixture()
  assert.deepEqual(cellDependencies(table, 0), [1, 3])
  assert.deepEqual(cellDependencies(table, 1), [2, 3])
  assert.deepEqual(cellDependencies(table, 2), [], 'the top alone: pinned, never held')
  assert.deepEqual(cellDependencies(table, 3), [], 'a cell the table does not hold')
})

test("a bundle's pages are its vertices and local triangles, and nothing else", () => {
  const [page] = worldBundlePages(worldPage(5), 1, 0)
  assert.deepEqual([...page.positions], [5, 0, 0, 6, 0, 0, 5, 1, 0])
  assert.deepEqual([...page.indices], [0, 1, 2])
  const both = new Uint8Array([...worldPage(0), ...worldPage(1)])
  assert.equal(worldBundlePages(both, 2, 0).length, 2)
  assert.throws(() => worldBundlePages(both, 1, 0), refused, 'bytes past its pages')
  assert.throws(() => worldBundlePages(worldPage(0), 2, 0), refused, 'a page past its bytes')
  const wrong = worldPage(0)
  new DataView(wrong.buffer).setUint16(44, 3, true)
  assert.throws(() => worldBundlePages(wrong, 1, 0), refused, 'a vertex it does not carry')
})
