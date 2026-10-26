import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { writtenBytes } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { frontCamera } from '../../session/engine/pagesEngineScenes.fixture.ts'
import {
  disposePagedQuad,
  pagedQuad,
  pagedQuadBackend,
  FIRST,
  SECOND,
} from './pagedQuad.fixture.ts'
import type { EngineDiagnostic } from '../../diagnostic/types.ts'

/** The two clusters of the quad; the second without a page when `both` is false, so a cluster the
 *  cache left without one can be told apart. */
const quad = (both: boolean) => pagedQuad([{ corners: FIRST }, { corners: SECOND, paged: both }])

// The page on disk is the `WGP3` object the compiler wrote, byte for byte, and it reaches the install
// pass whole (`geometry/pages/install/installer.ts`): the pass writes the resident page the shaders
// read, transcoded from it, into the slot the cache gave that cluster. A slot is as wide as the
// widest resident page; no two clusters share one.
test('an admitted cluster stages its quantized page bytes, whole, for a slot of its own', async () => {
  installGpuGlobals()
  const events: EngineDiagnostic[] = []
  const fixture = quad(true)
  const { gpu, backend } = pagedQuadBackend(fixture, events)
  try {
    await backend.prepare()
    backend.render(frontCamera())
    await backend.flush()
    const pool = gpu.buffers.find((buffer) => buffer.label === 'Trillion3D geometry page cache')
    assert.ok(pool, 'no geometry page pool')
    const declared = events.find((event) => event.phase === 'geometry-pages')
    const slotBytes = Number(declared?.context.slotBytes)
    // The slot holds the resident page, which the page on disk transcodes into (smaller or not).
    for (const page of fixture.encoded) {
      assert.ok(page.residentBytes > 0, 'the encoder says what the page takes in the pool')
      assert.ok(slotBytes >= page.residentBytes)
    }
    assert.ok(pool.size >= fixture.encoded.length * slotBytes, 'a slot for each page')
    const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
    const staged = gpu.writes
      .filter((write) => /page install staging/.test(write.buffer.label ?? ''))
      .map((write) => hex(writtenBytes(write)))
    assert.deepEqual(staged.sort(), fixture.encoded.map((page) => hex(page.data)).sort())
  } finally {
    await disposePagedQuad(backend, fixture)
  }
})

// A cluster the cache left without a geometry page is not silently drawn from one: it keeps the
// source float buffers, and the engine says how many clusters are on each side.
test('clusters without a geometry page are counted, not assumed', async () => {
  installGpuGlobals()
  const events: EngineDiagnostic[] = []
  const fixture = quad(false)
  const { backend } = pagedQuadBackend(fixture, events)
  try {
    await backend.prepare()
    const split = events.find((event) => event.phase === 'geometry-pages')
    assert.ok(split, 'the engine published no geometry-page count')
    assert.equal(split.context.fromGeometryPage, 1)
    assert.equal(split.context.fromSourceGeometry, 1)
    assert.equal(split.context.clusters, 2)
  } finally {
    await disposePagedQuad(backend, fixture)
  }
})
