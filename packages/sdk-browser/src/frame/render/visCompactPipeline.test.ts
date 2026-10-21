import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { webgpuPagesEngine } from '../backend/pages.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { indirectDraws, installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND, dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { quadScene, camera, quadBackend } from '../backend/testScenes.fixture.ts'
import type { RasterView } from '../backend/runtime.ts'
import {
  assertOccluderImage,
  occluderScene,
  preparedOccluderRun,
} from '../backend/testOccluder.fixture.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { MODE_DEPTH, rasterEntry } from '../../visibility/raster/contract.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

test('GPU Hi-Z builds the pyramid after the main pass, whose slots write the visibility buffer alone', async () => {
  installGpuGlobals()
  const scene = occluderScene()
  const { source, metadata: occluderMetadata, indices, associations, geometry, material } = scene
  const metadata: ClusterManifest = {
    ...occluderMetadata,
    formatVersion: 1,
    status: 'ready',
    key: 'occluder',
    scope: 'full',
    sourceTriangles: 4,
    selectedTriangles: 4,
    selectedNodes: 0,
    totalNodes: 0,
  }
  const viewport: [number, number] = [32, 32]
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const { device, passes, dispatches, textures, draws } = fakeDevice({
    ...BACKEND,
    packed: packDagSelection(collected.roots),
  })
  const run = await preparedOccluderRun(scene, metadata, collected.roots, device, viewport)
  const { cam, cpu } = run,
    backend = run.backend as ReturnType<typeof webgpuPagesEngine> & {
      selectedPageIds(): string[]
      rasterView(): RasterView
    }
  assert.ok(textures.some((texture) => texture.format === 'r32float'))
  backend.render(cam)
  await backend.flush()
  draws.length = 0
  dispatches.length = 0
  backend.render(cam)
  // Each pass's hardware slots write the one visibility buffer alone, their depth target held
  // read-only; the pyramid is built once the main pass's software depth is down.
  const visPasses = passes.filter(
    (pass) =>
      pass.label === 'Trillion3D visibility primary' ||
      pass.label === 'Trillion3D visibility secondary',
  )
  assert.ok(visPasses.length >= 1)
  for (const pass of visPasses) {
    assert.deepEqual(pass.colors, [])
    assert.equal(pass.depth?.depthReadOnly, true)
  }
  const at = (entry: string) => dispatchedEntries(dispatches).indexOf(entry)
  assert.ok(at(rasterEntry('fine', MODE_DEPTH)) >= 0)
  assert.ok(at('buildHiz') > at(rasterEntry('fine', MODE_DEPTH)))
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort())
  assertOccluderImage(backend, cpu.shown, collected.roots, cam, viewport)
  indirectDraws(draws)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('a device that refuses the draw compaction refuses the scene by name', async () => {
  installGpuGlobals()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const collected = collectClusterPages(source, graphDraws(source, associations), metadata, indices)
  const { device } = fakeDevice({
    ...BACKEND,
    packed: packDagSelection(collected.roots),
    failCompact: true,
  })
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  // The GPU cut draws through the compaction alone (#1483): no per-page loop stands in for it.
  await assert.rejects(backend.prepare(), /WEBGPU_DRAW_UNAVAILABLE/)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('normal GPU rendering never copies the image to CPU staging buffers', async () => {
  installGpuGlobals()
  const { device, textureBufferCopies } = fakeDevice(BACKEND)
  const { fixture, backend } = quadBackend(device)
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    textureBufferCopies.length = 0
    for (let i = 0; i < 3; i++) backend.render(camera())
    assert.equal(textureBufferCopies.length, 0, 'beauty must not enqueue image readback')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
