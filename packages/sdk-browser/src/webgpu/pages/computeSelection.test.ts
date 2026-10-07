import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../page/selection/selection.ts'
import { selectVisiblePages } from '../../page/cut/cut.fixture.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { quadScene, camera, quadBackend } from './testScenes.fixture.ts'
import { coarseQuadScene } from './testOccluder.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import type { Engine } from '../../engine/types.ts'

test('webgpu pages cut on the GPU name its clusters once the readback lands', async () => {
  installGpuGlobals()
  const { device } = mockGpu({
    limits: { maxBufferSize: 1 << 24, maxStorageBufferBindingSize: 1 << 24 },
  })
  const { fixture, backend } = quadBackend(device)
  await backend.prepare()
  backend.render(camera())
  await backend.flush()
  backend.render(camera())
  assert.deepEqual((backend as Engine).selectedPageIds().sort(), ['0', '1'])
  // By mesh, primitive and page: unique where two clusters share one index page URL.
  assert.deepEqual((backend as Engine).selectedClusterIds().sort(), ['0/0/0', '0/0/1'])
  backend.dispose()
  fixture.geometry.dispose()
  fixture.material.dispose()
})

test('webgpu compute selection page ids match the CPU oracle for the same camera and pixelError', async () => {
  installGpuGlobals()
  const { source, metadata, indices, associations, geometry, material } = quadScene()
  const collected = collectClusterPages(source, metadata, indices, associations)
  const packed = packDagSelection(collected.roots)
  const { device } = mockGpu({
    packed,
    limits: { maxBufferSize: 1 << 24, maxStorageBufferBindingSize: 1 << 24 },
  })
  const viewport: [number, number] = [960, 540]
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
    pixelError: 0,
  }) as Engine
  const cam = camera()
  const cpu = selectVisiblePages(collected.roots, engineCamera(cam), {
    pixelError: 0,
    viewport,
  })
  await backend.prepare()
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort())
  assert.equal(backend.metrics().clusters, cpu.visible)
  assert.equal(backend.metrics().frustumRejected, cpu.frustumRejected)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})

test('webgpu compute selection matches the CPU coarse LOD cut', async () => {
  installGpuGlobals()
  // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
  const {
    source,
    metadata,
    indices: allIndices,
    associations,
    geometry,
    material,
  } = coarseQuadScene(0.001)
  const viewport: [number, number] = [960, 540]
  const collected = collectClusterPages(source, metadata, allIndices, associations)
  const packed = packDagSelection(collected.roots)
  const { device } = mockGpu({
    packed,
    limits: { maxBufferSize: 1 << 24, maxStorageBufferBindingSize: 1 << 24 },
  })
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices: allIndices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
    pixelError: 10,
  }) as Engine
  const cam = camera()
  const cpu = selectVisiblePages(collected.roots, engineCamera(cam), {
    pixelError: 10,
    viewport,
  })
  await backend.prepare()
  backend.render(cam)
  await backend.flush()
  backend.render(cam)
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort())
  assert.equal(backend.metrics().clusters, cpu.visible)
  assert.equal(backend.metrics().lodLevel, cpu.lodLevel)
  backend.dispose()
  geometry.dispose()
  material.dispose()
})
