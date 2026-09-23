import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './pages.ts';
import { collectClusterPages, selectVisiblePages } from '../../page/selection/selection.ts';
import { packDagSelection } from '../../gpu/dag/selection.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera, quadBackend } from './testScenes.fixture.ts';
import { coarseQuadScene } from './testOccluder.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import type { WebgpuPagesBackend } from './runtime.ts';

test('webgpu pages without compute keep the CPU cut and report gpuDriven false', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  assert.equal(backend.capabilities.gpuDriven, false);
  backend.render(camera());
  assert.deepEqual((backend as WebgpuPagesBackend).selectedPageIds().sort(), ['0', '1']);
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('webgpu compute selection page ids match the CPU oracle for the same camera and pixelError', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device } = mockGpu(undefined, packed);
  const viewport: [number, number] = [960, 540];
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
    pixelError: 0,
  }) as WebgpuPagesBackend;
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cameraMoteur(cam), {
    pixelError: 0,
    viewport,
  });
  await backend.prepare();
  assert.equal(backend.capabilities.gpuDriven, true);
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort());
  assert.equal(backend.metrics().clusters, cpu.visible);
  assert.equal(backend.metrics().frustumRejected, cpu.frustumRejected);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu compute selection matches the CPU coarse LOD cut', async () => {
  installGpuGlobals();
  // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
  const {
    source,
    metadata,
    indices: allIndices,
    associations,
    geometry,
    material,
  } = coarseQuadScene(0.001);
  const viewport: [number, number] = [960, 540];
  const collected = collectClusterPages(source, metadata, allIndices, associations);
  const packed = packDagSelection(collected.roots);
  const { device } = mockGpu(undefined, packed);
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices: allIndices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
    pixelError: 10,
  }) as WebgpuPagesBackend;
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cameraMoteur(cam), {
    pixelError: 10,
    viewport,
  });
  await backend.prepare();
  backend.render(cam);
  await backend.flush();
  backend.render(cam);
  assert.equal(backend.capabilities.gpuDriven, true);
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort());
  assert.equal(backend.metrics().clusters, cpu.visible);
  assert.equal(backend.metrics().lodLevel, cpu.lodLevel);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
