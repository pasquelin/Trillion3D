import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { ROW_WORDS } from '../../visibility/types.ts'
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { camera } from './testScenes.fixture.ts'
import { deepCoarseQuadsScene } from './coarseQuads.fixture.ts'
import { DAG_READBACK_SLOTS } from '../../geometry/dag/layout.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { VISIBLE_RECORD_WORDS } from '../../geometry/dag/visible/layout.ts'
import { VIS_HW, VIS_SW, VISIBLE_HEADER_WORDS } from '../../geometry/dag/visible/layout.fixture.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

/**
 * Frames a use protects its slot for: the frame that used it and the one after, so a slot any view
 * — a light's, a view drawn beside the main one — used in the frame before is still in use, whatever
 * order the views read in.
 */
const EVICT_IN_USE = 2

test('GPU camera jumps reclaim detail slots while preserving pinned coarse coverage', async () => {
  installGpuGlobals()
  const fixture = deepCoarseQuadsScene()
  const collected = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  const packed = packDagSelection(collected.roots)
  const { device, draws, buffers } = fakeDevice({ ...BACKEND, packed })
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: device,
    // Three streaming slots of the widest page (24 bytes) beside the two roots' (`geometryPoolFor`):
    // five, below the eight clusters' 144, so the pool holds no home of each (`poolBytes`) and a
    // jump between the quads evicts.
    maxResidentPages: 3,
    viewport: [32, 32],
  })
  const cam = camera()
  try {
    await backend.prepare()
    for (const x of [0, 100, 0, 100]) {
      cam.position.set(x, 0, 5)
      cam.lookAt(x, 0, 0)
      cam.updateMatrixWorld()
      const expected = x ? ['b0', 'b1'] : ['0', '1']
      // Selection readback, residency upload and adoption are asynchronous. Stop on the
      // requested detail cut; the finite cap detects a stalled pipeline, not a frame deadline.
      for (let step = 0; step < 32; step++) {
        draws.length = 0
        backend.render(cam)
        assert.ok(drawnPageIds(buffers).length > 0, 'current cut must retain visible coverage')
        await backend.flush()
        assert.equal(backend.metrics().submittedTriangles, 2)
        const selected = backend.selectedPageIds().sort()
        if (selected.length === expected.length && selected.every((id, i) => id === expected[i]))
          break
      }
      assert.deepEqual(backend.selectedPageIds().sort(), expected, 'detail cut must converge')
    }
    assert.ok(backend.metrics().cacheEvictions! > 0)
  } finally {
    await backend.dispose()
    fixture.dispose()
  }
})

test('a recycled pool slot is described by its new cluster in the decoded records, which the host never writes', async () => {
  installGpuGlobals()
  const { device, writes, buffers } = fakeDevice(BACKEND),
    fixture = deepCoarseQuadsScene()
  // Eight clusters share five slots, the two roots' among them, so every jump between the two
  // primitives recycles slots on eviction.
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: device,
    // Three streaming slots of the widest page (24 bytes) beside the two roots' (`geometryPoolFor`):
    // five, below the eight clusters' 144, so the pool holds no home of each (`poolBytes`) and a
    // jump between the quads evicts.
    maxResidentPages: 3,
    viewport: [32, 32],
  })
  const view = camera()
  const look = (x: number) => {
    view.position.set(x, 0, 5)
    view.lookAt(x, 0, 0)
    view.updateMatrixWorld()
    backend.render(view)
  }
  try {
    await backend.prepare()
    // Each view held until the other's pages are out of use and their order read back.
    for (let round = 0; round < 6; round++)
      for (let image = 0; image <= EVICT_IN_USE + DAG_READBACK_SLOTS; image++) {
        look(round % 2 ? 100 : 0)
        await backend.flush()
      }
    assert.ok(backend.metrics().cacheEvictions! > 0, 'the run has to recycle slots')
    const table = buffers.findLast((buffer) => buffer.label === 'Trillion3D decoded clusters')
    assert.ok(table, 'the decoded clusters are allocated')
    const rows = new Uint32Array(
      table.data.buffer,
      table.data.byteOffset,
      table.data.byteLength / 4,
    )
    // The clusters the image reads, the software raster's from the start of the list and the
    // hardware raster's from its end (`geometry/dag/visible/layout.ts`), the indices of the list.
    const list = buffers.findLast((buffer) => buffer.label === 'Trillion3D DAG visible clusters')!
    const header = new Uint32Array(list.data.buffer, list.data.byteOffset, VISIBLE_HEADER_WORDS)
    const cap = (list.size / 4 - VISIBLE_HEADER_WORDS) / VISIBLE_RECORD_WORDS
    const live = [
      ...Array.from({ length: header[VIS_SW] }, (_, k) => k),
      ...Array.from({ length: header[VIS_HW] }, (_, k) => cap - 1 - k),
    ]
    assert.ok(live.length > 0, 'clusters are read')
    const seen = new Set<number>(),
      slots = new Set<number>()
    for (const v of live) {
      const base = v * ROW_WORDS,
        indexCount = rows[base + PAGE_INFO.at.indexCount]
      if (!indexCount) continue
      // A record names itself by its place in the list, so a recycled slot cannot be read through
      // the identifier of its predecessor.
      assert.equal(rows[base + PAGE_INFO.at.packedBase], (v + 1) << 8, `cluster ${v} identifier`)
      // Its index range is one of the fixture's clusters, and no two clusters claim the same cluster
      // or the same GPU slot: a record still describing the cluster its slot was recycled from would
      // do both.
      assert.ok(indexCount === 3 || indexCount === 6, `cluster ${v} index count ${indexCount}`)
      assert.equal(
        seen.has(rows[base + PAGE_INFO.at.selectionIndex]),
        false,
        `cluster ${v} duplicates cluster ${rows[base + PAGE_INFO.at.selectionIndex]}`,
      )
      assert.equal(
        slots.has(rows[base + PAGE_INFO.at.pageOffset]),
        false,
        `cluster ${v} duplicates slot ${rows[base + PAGE_INFO.at.pageOffset]}`,
      )
      seen.add(rows[base + PAGE_INFO.at.selectionIndex])
      slots.add(rows[base + PAGE_INFO.at.pageOffset])
    }
    // The records describe the resident instances the cut draws: a leaked one would show up as a
    // record past the resident pages.
    assert.ok(
      seen.size > 0 && seen.size <= backend.metrics().residentPages!,
      `live clusters ${seen.size}`,
    )
    assert.equal(
      writes.filter((write) => write.buffer.label === 'Trillion3D decoded clusters').length,
      0,
      'the decode writes the records: the host sends none',
    )
  } finally {
    backend.dispose()
    fixture.dispose()
  }
})
