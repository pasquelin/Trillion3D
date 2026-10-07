import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from '../pages.ts'
import { collectClusterPages } from '../../../page/selection/selection.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { quadScene, camera, quadBackend } from '../testScenes.fixture.ts'
import { assertOccluderImage, occluderScene, preparedOccluderRun } from '../testOccluder.fixture.ts'
import type { Engine } from '../../../engine/types.ts'
import { DEFAULT_SCOPE, type ClusterManifest } from '../../../../../sdk-core/src/index.ts'

test('webgpu Hi-Z remaining pages stay a subset of the CPU selection oracle', async () => {
  installGpuGlobals()
  const { device } = mockGpu()
  const scene = occluderScene()
  const { source, indices, associations, geometry, material } = scene
  // `occluderScene` builds `metadata` with only `errorModel`/`clusterStrategy`/`primitives`: the
  // rest of `ClusterManifest` is never read past `primitives`, so it is filled with placeholders.
  const metadata: ClusterManifest = {
    schema: 0,
    status: 'ready',
    key: 'test-occluder',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    ...scene.metadata,
  }
  const viewport: [number, number] = [32, 32]
  const collected = collectClusterPages(source, metadata, indices, associations)
  const run = await preparedOccluderRun(scene, metadata, collected.roots, device, viewport)
  const { cam, cpu } = run,
    backend = run.backend as Engine
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  const selected = cpu.shown.map((page) => page.url).sort()
  assert.deepEqual(backend.selectedPageIds().sort(), selected)
  assert.deepEqual(selected, ['back', 'front'])
  // Hi-Z drops the occluded page from the image: only the front page's identifiers survive.
  assertOccluderImage(backend, cpu.shown, collected.roots, cam, viewport)
  // The GPU counts its cut where the verdict is given, before occlusion (#1483): what Hi-Z drops
  // is read from the image above, never from a CPU sum of the drawn triangles.
  assert.equal(backend.metrics().submittedTriangles, backend.metrics().selectedTriangles)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test("a visibility pass the device fails is the image's failure, said once: no other draw path", async () => {
  installGpuGlobals()
  const { device } = mockGpu({ failVisPass: true })
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const events: Array<{ phase: string; context: Record<string, unknown> }> = []
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  }) as Engine
  await backend.prepare()
  assert.throws(() => backend.render(camera()), /VIS_FAIL/)
  // A traced failure reaches the observer from the diagnostic queue, a task later.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const failures = events.filter((event) => event.phase === 'visibility-render-failed')
  assert.equal(failures.length, 1)
  assert.equal(typeof failures[0].context.error, 'string')
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('a device without an r32uint visibility target refuses the scene by name', async () => {
  installGpuGlobals()
  const { device } = mockGpu({ rejectR32: true })
  const { fixture, backend } = quadBackend(device)
  await assert.rejects(backend.prepare(), /WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE/)
  backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
})
