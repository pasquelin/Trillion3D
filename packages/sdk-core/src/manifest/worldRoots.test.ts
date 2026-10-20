// An HLOD 0 cell holds the bundles of its HLOD 1 roots, and a bundle's pages are ranges of it,
// read off the table. The table's records are read in `worldRootsTable.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../contracts/cache.ts'
import { bundlePageRanges } from './worldRoots.ts'
import {
  worldPage,
  worldRootsFixture,
} from '../../../sdk-browser/src/geometry/hlod/worldRootsPages.fixture.ts'
import { encodeWorldRoots } from './worldRootsRecords.fixture.ts'
import { readWorldRoots } from './worldRootsTable.ts'

const refused = (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE'

test('each HLOD 0 cell names the bundles it holds, ascending', () => {
  const { table } = worldRootsFixture()
  assert.deepEqual(table.hlod, [[1, 3], [2, 3], [0]])
})

test("a bundle's pages are the ranges its records name, tiling it exactly", () => {
  const { table, bin } = worldRootsFixture()
  const { offset, bytes } = table.bundles[2]
  const [page] = bundlePageRanges(table, 2)
  const own = bin.subarray(offset, offset + bytes)
  assert.deepEqual(
    [...own.subarray(page.offset, page.offset + page.bytes)],
    [...worldPage(2).bytes],
  )
  assert.deepEqual(
    bundlePageRanges(table, 3).map(({ offset }) => offset),
    [0, 1, 2].map((k) => k * worldPage(3).bytes.byteLength),
    'a bundle of three pages, end to end',
  )
  // A record naming another bundle, or a page that does not start where the last ended.
  const { spec } = worldRootsFixture()
  spec.pages[2] = { ...spec.pages[2], offset: 4 }
  assert.throws(
    () => bundlePageRanges(readWorldRoots(encodeWorldRoots(spec)), 2),
    refused,
    'a page out of its place',
  )
})
