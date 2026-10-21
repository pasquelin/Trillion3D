import test from 'node:test'
import { MANIFEST_IDENTITY } from '../../session/engine/pagesEngine.fixture.ts'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { PAGE_INFO_STRIDE, ROW_WORDS } from '../../visibility/types.ts'
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { camera } from './testScenes.fixture.ts'
import { twoCoarseQuadsScene } from './coarseQuads.fixture.ts'
import { deepQuadScene } from './deepQuad.fixture.ts'
import { EVICT_IN_USE } from '../../gpu/sort/rank.ts'
import { DAG_READBACK_SLOTS } from '../../geometry/dag/layout.ts'
import type { ClusterManifest, Primitive } from '../../../../sdk-core/src/contracts/geometry.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

/** `twoCoarseQuadsScene`, its manifest completed with the cache-identity fields the fixture
 *  omits — unread by the backends under test. Its second primitive's `pages` carry every `Page`
 *  field at runtime (`...page` spread in the fixture); only the inline callback annotation
 *  there narrows the static type to `{ url: string }`, which this cast corrects. */
function scene() {
  const raw = twoCoarseQuadsScene(deepQuadScene)
  const metadata: ClusterManifest = {
    ...raw.metadata,
    ...MANIFEST_IDENTITY,
    primitives: raw.metadata.primitives as Primitive[],
  }
  return { ...raw, metadata }
}

test('GPU camera jumps reclaim detail slots while preserving pinned coarse coverage', async () => {
  installGpuGlobals()
  const fixture = scene()
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
        assert.ok(
          drawnPageIds(buffers, packed).length > 0,
          'current cut must retain visible coverage',
        )
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

test('a recycled page-table row describes its new cluster and reaches the GPU before the image reads it', async () => {
  installGpuGlobals()
  const { device, writes, buffers, submits } = fakeDevice(BACKEND),
    fixture = scene()
  // Eight clusters share five slots, the two roots' among them, so every jump between the two
  // primitives recycles rows on eviction.
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
    assert.ok(backend.metrics().cacheEvictions! > 0, 'the run has to recycle rows')
    const table = buffers.find((buffer) => buffer.label === 'Trillion3D page table')
    assert.ok(table, 'the page table is allocated once')
    const rows = new Uint32Array(
      table.data.buffer,
      table.data.byteOffset,
      table.data.byteLength / 4,
    )
    // The rows the image reads, `[0, rows)` of the draw compaction, its uniform's first word
    // (`encodeDraw`; `../../geometry/rows/slots.ts`: ranks stay contiguous) — the last made, a grown
    // table's —; a rank past them, left by a row moved down, is read by no pass.
    const uniform = buffers.findLast(
      (buffer) => buffer.label === 'Trillion3D draw compaction uniform',
    )!
    const live = new Uint32Array(uniform.data.buffer, uniform.data.byteOffset, uniform.size / 4)[0]
    assert.ok(live > 0 && live <= table.size / PAGE_INFO_STRIDE, `${live} rows read`)
    const seen = new Set<number>(),
      slots = new Set<number>()
    for (let row = 0; row < live; row++) {
      const base = row * ROW_WORDS,
        indexCount = rows[base + PAGE_INFO.at.indexCount]
      if (!indexCount) continue
      // A live row names itself, so a recycled row cannot be read through the identifier of its predecessor.
      assert.equal(rows[base + PAGE_INFO.at.packedBase], (row + 1) << 8, `row ${row} identifier`)
      // Its index range is one of the fixture's clusters, and no two live rows claim the same cluster or
      // the same GPU slot: a row still describing the cluster it was recycled from would do both.
      assert.ok(indexCount === 3 || indexCount === 6, `row ${row} index count ${indexCount}`)
      assert.equal(
        seen.has(rows[base + PAGE_INFO.at.selectionIndex]),
        false,
        `row ${row} duplicates cluster ${rows[base + PAGE_INFO.at.selectionIndex]}`,
      )
      assert.equal(
        slots.has(rows[base + PAGE_INFO.at.pageOffset]),
        false,
        `row ${row} duplicates slot ${rows[base + PAGE_INFO.at.pageOffset]}`,
      )
      seen.add(rows[base + PAGE_INFO.at.selectionIndex])
      slots.add(rows[base + PAGE_INFO.at.pageOffset])
    }
    // The rows are a cache of the resident instances the cut draws or asks (`../../geometry/rows/slots.ts`): a
    // leaked row would show up as a live row past the resident pages, and none at all as a lost one.
    assert.ok(
      seen.size > 0 && seen.size <= backend.metrics().residentPages!,
      `live rows ${seen.size}`,
    )
    const lastRowWrite = writes
      .filter((write) => write.buffer.label === 'Trillion3D page table')
      .at(-1)
    assert.ok(lastRowWrite, 'rows are uploaded')
    assert.ok(
      lastRowWrite.seq < submits.at(-1)!,
      'a row is uploaded before the image that reads it is submitted',
    )
  } finally {
    backend.dispose()
    fixture.dispose()
  }
})
