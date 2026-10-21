import test from 'node:test'
import { MANIFEST_IDENTITY } from '../../session/engine/pagesEngine.fixture.ts'
import assert from 'node:assert/strict'
import { isDrawnNode } from '../../scene/host/graph/kinds.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  drawnPageIds,
  indirectDraws,
  installGpuGlobals,
} from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND, dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import {
  quadScene,
  camera,
  mixedBinScene,
  quadBackend,
  flushedGpuScene,
} from '../backend/testScenes.fixture.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'

test('webgpu pages raster consumes the GPU cache and does not attach a mesh per visible page', async () => {
  installGpuGlobals()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const { draws, writes, dispatches, buffers, packed, backend } = await flushedGpuScene({
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
  })
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  let pageMeshes = 0
  backend.scene.traverse((o) => {
    if (isDrawnNode(o)) pageMeshes++
  })
  assert.equal(pageMeshes, 0)
  assert.equal(backend.metrics().clusters, 2)
  assert.equal(backend.metrics().selectedTriangles, 2)
  assert.equal(backend.metrics().residentPages, 2)
  assert.ok(writes.length >= 2)
  // The scene has one prepared material class: what the frame composes once for the resolve (the
  // material cache), the bins of the image, then one dispatch of its bin, and no surface draw.
  assert.deepEqual(
    dispatchedEntries(dispatches).filter((entry) => /Bins$|^shade_/.test(entry)),
    [
      ...['shade_clear', 'shade_marks', 'shade_rows', 'shade_tris'],
      ...['clearBins', 'countBins', 'reserveBins', 'scatterBins', 'shade_cs'],
    ],
  )
  assert.ok(!draws.some((d) => d.entryPoint?.startsWith('shade_')))
  // The cut reaches the hardware raster through the image mask, which its indirect commands consume
  // as instances — each row twice: drawn by the main pass, then by the identifiers pass over
  // everything drawn (`encodeWebgpuVisibilityPasses`) —, and the software raster through the
  // cluster split, which bins each image's rows before either compaction reads them.
  assert.deepEqual(drawnPageIds(buffers, packed), [0, 1])
  const vis = indirectDraws(draws)
  assert.equal(
    vis.reduce((n, d) => n + (d.instanceCount ?? 0), 0),
    2 * 2,
  )
  assert.equal(dispatchedEntries(dispatches).includes('bin'), true)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('vis drawIndirect consumes GPU instance indices against one unsorted page table', async () => {
  installGpuGlobals()
  const {
    source,
    metadata: metadataPartial,
    indices,
    associations,
    geoA,
    geoB,
    front,
    both,
  } = mixedBinScene()
  const metadata: ClusterManifest = { ...metadataPartial, ...MANIFEST_IDENTITY }
  const { draws, dispatches, buffers, packed, backend } = await flushedGpuScene({
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
  })
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  // The two bins — front-only and double-sided — hold two indirect commands on a shared page
  // table, and read the SAME image mask.
  assert.deepEqual(drawnPageIds(buffers, packed), [0, 1])
  // The cluster split bins the rows of every image, whichever raster draws them.
  assert.equal(dispatchedEntries(dispatches).includes('bin'), true)
  const vis = indirectDraws(draws)
  assert.ok(vis.length >= 2)
  assert.equal(
    vis.reduce((n, draw) => n + (draw.instanceCount ?? 0), 0),
    2 * 2,
    'each row drawn by the main pass, then by the identifiers pass',
  )
  assert.deepEqual([...new Set(vis.map((draw) => draw.bindOffset ?? 0))], [0])
  assert.ok(vis.every((draw) => draw.instanceBuffer && draw.groupsBuffer))
  backend.dispose()
  geoA.dispose()
  geoB.dispose()
  front.dispose()
  both.dispose()
})

// Root pages stay resident beside the streaming slots: a page cap under root coverage bounds the
// streaming slots alone, and the image is complete — never refused. The quad's two root pages and
// its one streaming slot pass the scene's two pages: the pool is the scene's, by name.
test('a page cap under root coverage keeps the cover beside it, and the image prepares', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const { fixture, backend } = quadBackend(device, {
    maxResidentPages: 1,
  })
  await backend.prepare()
  const metrics = backend.metrics()
  assert.equal(metrics.geometryPoolClamp, 'scene')
  assert.ok((metrics.geometryPoolSlots ?? 0) > 1, 'the slots hold root coverage')
  assert.equal(metrics.coverageReady, true)
  backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
})
