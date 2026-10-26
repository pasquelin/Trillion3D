// The world roots are records read straight from their bytes (`worldRootsTable.ts`), as the
// cook writes them (`chain/records.rs`): every field back at its rank, a binary past
// 4 GiB named whole, and a file that breaks its contract refused whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../contracts/cache.ts'
import {
  worldRootsDag,
  worldRootsFixture,
} from '../../../sdk-browser/src/geometry/hlod/worldRootsPages.fixture.ts'
import { encodeWorldRoots, encodeWorldRootsDag } from './worldRootsRecords.fixture.ts'
import { readWorldRoots, readWorldRootsDag } from './worldRootsTable.ts'

const refused = (error: unknown) => error instanceof EngineError && error.code === 'INVALID_CACHE'

test('the table reads every bundle, page and HLOD 0 cell back at its record', () => {
  const { spec, bytes } = worldRootsFixture((page) => page[0].toString(16).padStart(64, 'a'))
  const table = readWorldRoots(bytes)
  const { pages, ...head } = spec
  const { pages: _pages, ...read } = table
  assert.deepEqual(read, head, 'its header, payload, bundles and HLOD 0 cells')
  assert.equal(table.pages.count, pages.length)
  assert.deepEqual(
    pages.map((_, at) => table.pages.at(at)),
    pages,
  )
  // An unaligned view of the same bytes is read alike.
  const shifted = new Uint8Array(bytes.byteLength + 1)
  shifted.set(bytes, 1)
  assert.deepEqual(readWorldRoots(shifted.subarray(1)).hlod, spec.hlod)
})

test('the version before reads as this one, its layout being the same', () => {
  const { spec } = worldRootsFixture()
  spec.version = 36
  assert.equal(readWorldRoots(encodeWorldRoots(spec)).bundles.length, spec.bundles.length)
})

test('a binary past 4 GiB is named whole, its offsets in two words', () => {
  const { spec } = worldRootsFixture()
  const [first, second] = [3e9, 3e9]
  spec.bundles[0].bytes = first
  spec.bundles[1] = { ...spec.bundles[1], offset: first, bytes: second }
  spec.bundles[2].offset = first + second
  const page = spec.bundles[2].bytes,
    last = spec.bundles[3].bytes
  spec.bundles[3].offset = first + second + page
  spec.payload.bytes = first + second + page + last
  const table = readWorldRoots(encodeWorldRoots(spec))
  assert.deepEqual(
    table.bundles.map((bundle) => bundle.offset),
    [0, first, first + second, first + second + page],
  )
  assert.equal(table.payload.bytes, first + second + page + last)
})

test('a table that breaks its contract is refused whole', () => {
  const broken: ((spec: ReturnType<typeof worldRootsFixture>['spec']) => void)[] = [
    // Version 3 wrote a placed object's roots apart and its pages as floats: an old cache is
    // refused, cooked again.
    (spec) => (spec.version = 3),
    (spec) => (spec.bundles[2].offset += 4),
    (spec) => (spec.payload.bytes -= 1),
    (spec) => spec.bundles[1].dependencies.push(9),
    (spec) => (spec.hlod = [[1, 3, 4], ...spec.hlod.slice(1)]),
  ]
  for (const [at, breaks] of broken.entries()) {
    const { spec } = worldRootsFixture()
    breaks(spec)
    assert.throws(() => readWorldRoots(encodeWorldRoots(spec)), refused, `breakage ${at}`)
  }
  const { bytes } = worldRootsFixture()
  assert.throws(() => readWorldRoots(bytes.subarray(0, bytes.byteLength - 4)), refused, 'cut')
  assert.throws(() => readWorldRoots(Uint8Array.from([...bytes, 0, 0, 0, 0])), refused, 'longer')
  const renamed = bytes.slice()
  renamed[3] = 0
  assert.throws(() => readWorldRoots(renamed), refused, 'not a table')
})

test('the DAG reads every cluster and group back, in the cook’s rank', () => {
  const { clusters, groups, culling } = worldRootsDag()
  const read = readWorldRootsDag(encodeWorldRootsDag({ clusters, groups, culling }))
  assert.deepEqual(
    read.clusters,
    clusters.map(({ units: _, ...cluster }) => cluster),
  )
  assert.deepEqual(read.groups, groups)
  const outside = groups.map((g) => ({ ...g, children: [...g.children] }))
  outside[0].children.push(clusters.length)
  assert.throws(
    () => readWorldRootsDag(encodeWorldRootsDag({ clusters, groups: outside, culling })),
    refused,
  )
  assert.throws(
    () => readWorldRootsDag(encodeWorldRootsDag({ clusters, groups, culling }, 1)),
    refused,
  )
})
