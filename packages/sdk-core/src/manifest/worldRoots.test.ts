// A placed cell holds the world bundles its objects need, and a bundle's pages are viewed on
// their bytes. The table's records are read in `worldRootsTable.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../contracts/cache.ts'
import { cellDependencies, worldBundlePages } from './worldRoots.ts'
import { worldPage, worldRootsFixture } from './worldRoots.fixture.ts'
import { encodeWorldRoots } from './worldRootsRecords.fixture.ts'
import { readWorldRoots } from './worldRootsTable.ts'

const refused = (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE'

test('a cell holds the bundles past the pinned top its objects need, each once', () => {
  const { table } = worldRootsFixture()
  assert.deepEqual(cellDependencies(table, 0), [1, 3])
  assert.deepEqual(cellDependencies(table, 1), [2, 3])
  assert.deepEqual(cellDependencies(table, 2), [], 'the top alone: pinned, never held')
  assert.deepEqual(cellDependencies(table, 3), [], 'a cell the table does not hold')
})

test("a bundle's pages are the geometry pages its records name, tiling it exactly", () => {
  const { table, bin } = worldRootsFixture()
  const { offset, bytes } = table.bundles[2]
  const [page] = worldBundlePages(table, 2, bin.subarray(offset, offset + bytes))
  assert.deepEqual([...page.bytes], [...worldPage(2).bytes])
  const own = bin.subarray(offset, offset + bytes)
  assert.throws(() => worldBundlePages(table, 2, own.subarray(1)), refused, 'a page past its bytes')
  const longer = Uint8Array.from([...own, 0, 0, 0, 0])
  assert.throws(() => worldBundlePages(table, 2, longer), refused, 'bytes past its pages')
  // A record naming another bundle, or a page that does not start where the last ended.
  const { spec } = worldRootsFixture()
  spec.pages[2] = { ...spec.pages[2], offset: 4 }
  const moved = readWorldRoots(encodeWorldRoots(spec))
  assert.throws(() => worldBundlePages(moved, 2, own), refused, 'a page out of its place')
})
