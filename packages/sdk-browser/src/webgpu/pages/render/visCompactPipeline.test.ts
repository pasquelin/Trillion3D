import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest } from '../../../../../sdk-core/src/index.ts'
import { webgpuPagesEngine } from '../pages.ts'
import { collectClusterPages } from '../../../page/selection/selection.ts'
import { packDagSelection } from '../../../gpu/dag/selection.ts'
import { indirectDraws, installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import {
  BACKEND,
  dispatchedEntries,
  fakeDevice,
} from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { quadScene, camera, quadBackend } from '../testScenes.fixture.ts'
import type { RasterView } from '../runtime.ts'
import { assertOccluderImage, occluderScene, preparedOccluderRun } from '../testOccluder.fixture.ts'

test('GPU Hi-Z builds the pyramid after the vis occluder pass and loads the disoccluded vis pass', async () => {
  installGpuGlobals()
  const scene = occluderScene()
  const { source, metadata: occluderMetadata, indices, associations, geometry, material } = scene
  const metadata: ClusterManifest = {
    ...occluderMetadata,
    schema: 1,
    status: 'ready',
    key: 'occluder',
    scope: 'full',
    sourceTriangles: 4,
    selectedTriangles: 4,
    selectedNodes: 0,
    totalNodes: 0,
  }
  const viewport: [number, number] = [32, 32]
  const collected = collectClusterPages(source, metadata, indices, associations)
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
  // Occluders clear the target, the tested half reloads it; pyramid build then test, in
  // that order, between the two.
  const visPasses = passes.filter(
    (pass) =>
      pass.label === 'Trillion3D visibility primary' ||
      pass.label === 'Trillion3D visibility secondary',
  )
  assert.ok(visPasses.length >= 2)
  assert.equal(visPasses[visPasses.length - 2]?.colors[0]?.loadOp, 'clear')
  assert.equal(visPasses[visPasses.length - 2]?.depth?.depthLoadOp, 'clear')
  assert.equal(visPasses[visPasses.length - 1]?.colors[0]?.loadOp, 'load')
  assert.equal(visPasses[visPasses.length - 1]?.depth?.depthLoadOp, 'load')
  const at = (entry: string) => dispatchedEntries(dispatches).indexOf(entry)
  assert.ok(at('buildHiz') >= 0)
  assert.ok(at('testHiz') > at('buildHiz'))
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
  const collected = collectClusterPages(source, metadata, indices, associations)
  const { device } = fakeDevice({
    ...BACKEND,
    packed: packDagSelection(collected.roots),
    failCompact: true,
  })
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
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
