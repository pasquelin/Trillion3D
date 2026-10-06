// A world super-root page — raw world-space `f32` vertices and `u16` local indices — is not
// a `WGP3` page. Read at its world address from the cook's own fixture, every page becomes a decoded
// page whose indices are widened to `u32` one-to-one, a position list in world space and no pose,
// and it is uploaded and drawn by the WebGL2 cluster path unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { WebglClusterGeometry } from '../webgl/cluster/geometry.ts'
import { submitRanges } from '../webgl/cluster/submit.ts'
import { worldRootsBinSource, worldRootsPageFixtureSource } from './worldRootsPage.fixture.ts'
import { worldRootsPageAddress } from './worldPageServe.ts'

/** A WebGL2 context that records the buffer uploads and the draws, and no-ops the rest. */
function recordingGl() {
  const uploads: [number, number][] = [],
    draws: [number, number, number, number][] = [],
    call = () => {}
  const gl = new Proxy(
    {
      ARRAY_BUFFER: 34962,
      ELEMENT_ARRAY_BUFFER: 34963,
      FLOAT: 5126,
      UNSIGNED_INT: 5125,
      TRIANGLES: 4,
      createBuffer: () => ({}),
      createVertexArray: () => ({}),
      bufferData: (target: number, array: ArrayBufferView) =>
        void uploads.push([target, array.byteLength]),
      bufferSubData: () => {},
      drawElements: (mode: number, count: number, type: number, offset: number) =>
        void draws.push([mode, count, type, offset]),
    },
    { get: (known, name: string) => (known as Record<string, unknown>)[name] ?? call },
  )
  return { gl: gl as unknown as WebGL2RenderingContext, uploads, draws }
}

test('every page of the cooked world is drawn by WebGL2 in world space, 32-bit indexed', async () => {
  const { table, source } = worldRootsPageFixtureSource()
  assert.equal(table.pages.count, 4)
  for (let at = 0; at < table.pages.count; at++) {
    const { bundle, offset } = table.pages.at(at)
    const address = worldRootsPageAddress(table.payload.url, bundle, offset),
      page = await source.page(address),
      x = bundle // the fixture's page `bundle` is the triangle at x = bundle
    assert.deepEqual([...page.positions], [x, 0, 0, x + 1, 0, 0, x, 1, 0], `page ${bundle}`)
    assert.ok(page.indices instanceof Uint16Array, 'the page holds 16-bit local indices')
    const geometry = await source.geometry(address)
    assert.ok(geometry.index!.array instanceof Uint32Array, 'the draw reads UNSIGNED_INT')
    assert.deepEqual([...geometry.index!.array], [0, 1, 2], 'widened one-to-one')
    assert.deepEqual([...geometry.attributes.position.array], [...page.positions])
    const box = geometry.boundingBox!
    assert.deepEqual(
      [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z],
      [x, 0, 0, x + 1, 1, 0],
      'the world-space span, no pose',
    )
    // The engine's own upload path: the widened index list and the world position list reach GL.
    const { gl, uploads, draws } = recordingGl(),
      cache = new WebglClusterGeometry(gl, { position: 0, normal: -1, uv: -1, uv1: -1, color: -1 })
    cache.beginFrame()
    cache.bind(geometry)
    assert.deepEqual(
      uploads.sort(([a], [b]) => a - b),
      [
        [gl.ARRAY_BUFFER, 36],
        [gl.ELEMENT_ARRAY_BUFFER, 12],
      ],
      'three world-space vertices, three 32-bit indices',
    )
    submitRanges(gl, null, Int32Array.of(0), Int32Array.of(3), 1)
    assert.deepEqual(draws, [[gl.TRIANGLES, 3, gl.UNSIGNED_INT, 0]], 'one triangle, 32-bit indexed')
  }
})

test('a bundle of several pages resolves the one its offset names', async () => {
  // The cooked fixture gives each page a bundle; a bundle of two proves the offset → page mapping:
  // the source picks the page whose `offset` the table lists, in binary order.
  const low = worldPage(0),
    bin = new Uint8Array([...low, ...worldPage(2)])
  const pages = [
    { bundle: 0, offset: low.byteLength, level: 0, lodError: 0 },
    { bundle: 0, offset: 0, level: 1, lodError: 1 },
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
  assert.deepEqual([...atLow.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0])
  assert.deepEqual([...atHigh.positions], [2, 0, 0, 3, 0, 0, 2, 1, 0])
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
})

test('a bundle is fetched once for both WebGPU views of its page, asked apart', async () => {
  const { source, reads } = worldRootsPageFixtureSource(),
    at = (bundle: number) => worldRootsPageAddress('world-roots.bin', bundle, 0)
  await source.read(at(1))
  await source.attributes(at(1))
  assert.deepEqual(reads, [1], 'read then attributes: one fetch')
  await source.attributes(at(2))
  await source.read(at(2))
  assert.deepEqual(reads, [1, 2], 'attributes then read: one fetch')
  await Promise.all([source.read(at(3)), source.attributes(at(3))])
  assert.deepEqual(reads, [1, 2, 3], 'asked concurrently: one fetch')
  // Both views served, the bundle is let go: the source keeps no second cache.
  await source.read(at(1))
  assert.deepEqual(reads, [1, 2, 3, 1], 'a later request streams the bundle again')
})

test('a page owing its other WebGPU view holds its bundle within the pending budget', async () => {
  const { source, reads } = worldRootsPageFixtureSource(1),
    at = (bundle: number) => worldRootsPageAddress('world-roots.bin', bundle, 0)
  // Only `read` is asked of bundle 1 (a WebGL2 run, an evicted slot): bundle 2 owing a view next
  // pushes it past a budget of one, so it is let go and never held for the life of the scene.
  await source.read(at(1))
  await source.read(at(2))
  await source.attributes(at(2))
  assert.deepEqual(reads, [1, 2], 'the newest pair is still served by one read')
  await source.attributes(at(1))
  assert.deepEqual(reads, [1, 2, 1], 'the oldest owed bundle was let go')
  // The other half asked already aborted: the pair is broken, the bundle let go.
  await source.attributes(at(3))
  await assert.rejects(source.read(at(3), AbortSignal.abort()))
  await source.attributes(at(3))
  assert.deepEqual(reads, [1, 2, 1, 3, 3], 'a broken pair holds no bundle')
})
