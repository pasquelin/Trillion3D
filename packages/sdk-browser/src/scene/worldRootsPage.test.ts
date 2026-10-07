// A world super-root page is a `WGP3` geometry page in world space. Read at its world address
// from the cook's own fixture, every page is the cook's bytes, which a WebGPU page slot holds and
// decodes in place: its world-space positions and its indices, no pose.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { decodeGeometryPage } from '../page/codec/geometryPage.ts'
import { worldRootsBinSource, worldRootsPageFixtureSource } from './worldRootsPage.fixture.ts'
import { worldRootsPageAddress } from './worldPageServe.ts'

test('every page of the cooked world is served as its own bytes, in world space', async () => {
  const { table, source } = worldRootsPageFixtureSource()
  assert.equal(table.pages.count, 4)
  for (let at = 0; at < table.pages.count; at++) {
    const { bundle, offset } = table.pages.at(at)
    const address = worldRootsPageAddress(table.payload.url, bundle, offset),
      page = await source.page(address),
      x = bundle // the fixture's page `bundle` is the triangle at x = bundle
    assert.deepEqual([...page.bytes], [...worldPage(x).bytes], `page ${bundle}: the cook's bytes`)
    const slot = await source.read(address)
    assert.deepEqual([...slot], [...page.bytes], 'the GPU slot holds the page as cooked')
    const decoded = decodeGeometryPage(slot)
    assert.deepEqual([...decoded.attributes.position], [x, 0, 0, x + 1, 0, 0, x, 1, 0])
    assert.deepEqual([...decoded.indices], [0, 1, 2], 'no pose: the positions are world space')
  }
})

test('a bundle of several pages resolves the one its offset names', async () => {
  // The cooked fixture gives each page a bundle; a bundle of two proves the offset → page mapping:
  // the source picks the page whose `offset` the table lists, in binary order.
  const [low, high] = [worldPage(0).bytes, worldPage(2).bytes],
    bin = new Uint8Array([...low, ...high])
  const pages = [
    { bundle: 0, offset: 0, bytes: low.byteLength, level: 1, lodError: 1 },
    { bundle: 0, offset: low.byteLength, bytes: high.byteLength, level: 0, lodError: 0 },
  ]
  const table = {
      bundles: [{ offset: 0, bytes: bin.byteLength, sha256: '0', count: 2, dependencies: [] }],
      pages: { count: pages.length, at: (page: number) => pages[page] },
    } as unknown as WorldRoots,
    { source, reads } = worldRootsBinSource(table, bin)
  const [atLow, atHigh] = await Promise.all([
    source.page(worldRootsPageAddress('world-roots.bin', 0, 0)),
    source.page(worldRootsPageAddress('world-roots.bin', 0, low.byteLength)),
  ])
  assert.deepEqual([...atLow.bytes], [...low])
  assert.deepEqual([...atHigh.bytes], [...high])
  assert.deepEqual(reads, [0], 'both pages from one read of their bundle')
  await assert.rejects(source.page(worldRootsPageAddress('', 0, 4)), /WORLD_PAGE_MISSING/)
})

test('a shared bundle read serves every caller, one aborting; no bundle, no page', async () => {
  const { source, reads } = worldRootsPageFixtureSource(),
    address = worldRootsPageAddress('world-roots.bin', 1, 0)
  const [cancelled, kept, also] = await Promise.allSettled([
    source.page(address, AbortSignal.abort()),
    source.page(address),
    source.read(address),
  ])
  assert.equal(cancelled.status, 'rejected', 'the aborted caller is refused')
  assert.equal(kept.status, 'fulfilled', 'another caller of the same bundle gets its page')
  assert.equal(also.status, 'fulfilled', 'and so does the GPU slot read')
  assert.deepEqual(reads, [1], 'the three callers share one read of bundle 1')
  await assert.rejects(
    source.page(worldRootsPageAddress('world-roots.bin', 99, 0)),
    /WORLD_PAGE_MISSING/,
  )
  assert.deepEqual(reads, [1], 'an unknown bundle reads nothing')
  // Served, the bundle is let go: the source keeps no second cache.
  await source.read(address)
  assert.deepEqual(reads, [1, 1], 'a later request streams the bundle again')
})

test('a bundle read lands its other pages, which a reader then joins: the bundle is read once', async () => {
  const [low, high] = [worldPage(0).bytes, worldPage(2).bytes],
    bin = new Uint8Array([...low, ...high])
  const pages = [
    { bundle: 0, offset: 0, bytes: low.byteLength, level: 1, lodError: 1 },
    { bundle: 0, offset: low.byteLength, bytes: high.byteLength, level: 0, lodError: 0 },
  ]
  const table = {
    bundles: [{ offset: 0, bytes: bin.byteLength, sha256: '0', count: 2, dependencies: [] }],
    pages: { count: pages.length, at: (page: number) => pages[page] },
  } as unknown as WorldRoots
  const told: string[] = [],
    joined: Promise<Uint8Array>[] = []
  const { source, reads } = worldRootsBinSource(table, bin, (addresses) => {
    told.push(...addresses)
    // The pool takes them now, while the read is shared (`takeLandedPages`).
    for (const address of addresses) joined.push(source.read(address))
  })
  await source.read(worldRootsPageAddress('world-roots.bin', 0, 0))
  assert.deepEqual(told, [worldRootsPageAddress('world-roots.bin', 0, low.byteLength)])
  assert.deepEqual([...(await joined[0])], [...high])
  assert.deepEqual(reads, [0], 'one read of the bundle for both pages')
})
