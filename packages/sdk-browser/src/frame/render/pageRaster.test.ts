import test from 'node:test'
import assert from 'node:assert/strict'
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
import { MANIFEST_IDENTITY } from '../../session/engine/pagesEngine.fixture.ts'

test('webgpu pages raster consumes the GPU cache', async () => {
  installGpuGlobals()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const { draws, writes, dispatches, buffers, backend } = await flushedGpuScene({
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
  })
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  assert.equal(backend.metrics().clusters, 2)
  assert.equal(backend.metrics().selectedTriangles, 2)
  assert.equal(backend.metrics().residentPages, 2)
  assert.ok(writes.length >= 2)
  // The scene has one prepared material class: the bins of the image, then one dispatch of its bin,
  // and no surface draw.
  assert.deepEqual(
    dispatchedEntries(dispatches).filter((entry) => /Bins$|^shade_/.test(entry)),
    ['clearBins', 'countBins', 'reserveBins', 'scatterBins', 'shade_cs'],
  )
  assert.ok(!draws.some((d) => d.entryPoint?.startsWith('shade_')))
  // The cut reaches the hardware raster through its list of visible clusters, which the decode and
  // the bins turn to the indirect commands' instances — each cluster once, drawn by the main pass
  // (`encodeWebgpuVisibilityPasses`) —, and the software raster through the lists the bins write.
  assert.deepEqual(drawnPageIds(buffers), [0, 1])
  const vis = indirectDraws(draws)
  assert.equal(
    vis.reduce((n, d) => n + (d.instanceCount ?? 0), 0),
    2,
  )
  assert.ok(
    ['decodePlan', 'decode', 'binFinalize'].every((entry) =>
      dispatchedEntries(dispatches).includes(entry),
    ),
  )
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
  const { draws, dispatches, buffers, backend } = await flushedGpuScene({
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
  })
  draws.length = 0
  dispatches.length = 0
  backend.render(camera())
  // The two bins — front-only and double-sided — hold two indirect commands on a shared page
  // table, and read the SAME list of visible clusters.
  assert.deepEqual(drawnPageIds(buffers), [0, 1])
  // The bins list the clusters of every image, whichever raster draws them.
  assert.equal(dispatchedEntries(dispatches).includes('binFinalize'), true)
  const vis = indirectDraws(draws)
  assert.ok(vis.length >= 2)
  assert.equal(
    vis.reduce((n, draw) => n + (draw.instanceCount ?? 0), 0),
    2,
    'each row drawn once, by the main pass',
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
