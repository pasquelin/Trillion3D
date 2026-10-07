import test from 'node:test'
import assert from 'node:assert/strict'
import { selectVisiblePages } from '../../page/cut/cut.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import {
  quadScene,
  camera,
  quadBackend,
  flushedGpuScene,
  disposeQuadRun,
} from './testScenes.fixture.ts'
import { coarseQuadScene } from './testOccluder.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import type { Engine } from '../../engine/types.ts'

/** The device room the cut of these scenes takes. */
const LIMITS = { maxBufferSize: 1 << 24, maxStorageBufferBindingSize: 1 << 24 }

test('webgpu pages cut on the GPU name its clusters once the readback lands', async () => {
  installGpuGlobals()
  const { device } = mockGpu({ limits: LIMITS })
  const { fixture, backend } = quadBackend(device)
  await backend.prepare()
  backend.render(camera())
  await backend.flush()
  backend.render(camera())
  assert.deepEqual((backend as Engine).selectedPageIds().sort(), ['0', '1'])
  // By mesh, primitive and page: unique where two clusters share one index page URL.
  assert.deepEqual((backend as Engine).selectedClusterIds().sort(), ['0/0/0', '0/0/1'])
  disposeQuadRun(backend, fixture)
})

/**
 * `scene` cut on the GPU at `pixelError` — four resident pages, a 960 × 540 viewport — once its
 * readback has landed, and the CPU oracle's cut under the same camera.
 */
async function gpuAndCpuCuts(
  scene: Parameters<typeof flushedGpuScene>[0],
  pixelError: number,
) {
  const viewport: [number, number] = [960, 540]
  const { backend, roots } = await flushedGpuScene(
    scene,
    { maxResidentPages: 4, viewport, pixelError },
    LIMITS,
  )
  const cam = camera()
  backend.render(cam)
  const cpu = selectVisiblePages(roots, engineCamera(cam), { pixelError, viewport })
  return { backend: backend as Engine, cpu }
}

test('webgpu compute selection page ids match the CPU oracle for the same camera and pixelError', async () => {
  installGpuGlobals()
  const scene = quadScene()
  const { backend, cpu } = await gpuAndCpuCuts(scene, 0)
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort())
  assert.equal(backend.metrics().clusters, cpu.visible)
  assert.equal(backend.metrics().frustumRejected, cpu.frustumRejected)
  disposeQuadRun(backend, scene)
})

test('webgpu compute selection matches the CPU coarse LOD cut', async () => {
  installGpuGlobals()
  // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
  const scene = coarseQuadScene(0.001)
  const { backend, cpu } = await gpuAndCpuCuts(scene, 10)
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort())
  assert.equal(backend.metrics().clusters, cpu.visible)
  assert.equal(backend.metrics().lodLevel, cpu.lodLevel)
  disposeQuadRun(backend, scene)
})
