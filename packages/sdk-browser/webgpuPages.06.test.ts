import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { dagLevel } from './webgpuPagesTestDag.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('webgpu pages without compute keep the CPU cut and report gpuDriven false', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await backend.prepare();
  assert.equal(backend.capabilities.gpuDriven, false);
  backend.render(camera());
  assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1']);
  backend.dispose();
  geometry.dispose();
  material.dispose();
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
  });
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cam, { pixelError: 0, viewport, frame: 1 });
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
  const { source, metadata: base, indices, associations, geometry, material } = quadScene();
  const leaf = (id: number) => ({
    id,
    url: String(id),
    count: 3,
    min: [-1, -1, 0] as number[],
    max: [1, 1, 0] as number[],
    bytes: 12,
    sha256: 'x',
  });
  // Screen error 0.001 on the coarse cluster: at pixelError 10 the coarse cover wins everywhere.
  const level = dagLevel([leaf(0), leaf(1)], leaf(2), 0.001);
  const metadata = {
    errorModel: 'dag-group-qem-v1',
    clusterStrategy: 'dag-groups',
    primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', ...level }],
  };
  const allIndices = new Map([...indices, ['2', new Uint32Array([0, 1, 2])]]);
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
  });
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cam, { pixelError: 10, viewport, frame: 1 });
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
  void base;
});
