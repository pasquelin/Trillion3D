import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages } from '../sdk-core/index.ts';
import { exactPagesBackend } from './index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { rasterPageRecords } from './pageRaster.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { PAGE_BIND_ALIGN } from './gpuDraw.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera, mixedBinScene } from './webgpuPagesTestScenes.ts';

test('webgpu pages raster consumes the GPU cache and does not attach a mesh per visible page', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const { device, draws, writes } = mockGpu(undefined, packDagSelection(collected.roots));
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
  backend.render(camera());
  await backend.flush?.();
  draws.length = 0;
  backend.render(camera());
  let pageMeshes = 0;
  backend.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.Mesh).userData.blit) pageMeshes++;
  });
  assert.equal(pageMeshes, 0);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().selectedTriangles, 2);
  assert.equal(backend.metrics().residentPages, 2);
  assert.ok(writes.length >= 2);
  const vis = draws.filter((d) => d.indirect);
  const shade = draws.filter((d) => d.entryPoint === 'shade_vs');
  assert.equal(
    shade.reduce((n, d) => n + d.vertexCount, 0),
    3,
  );
  assert.ok(vis.length >= 1 && vis.length <= 6);
  assert.equal(
    vis.reduce((n, d) => n + (d.instanceCount ?? 0), 0),
    2,
  );
  assert.ok(vis.every((d) => d.firstInstance === 0));
  assert.ok(vis.every((d) => (d.bindOffset ?? 0) % PAGE_BIND_ALIGN === 0));
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), false);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('vis drawIndirect consumes GPU instance indices against one unsorted page table', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geoA, geoB, front, both } = mixedBinScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const { device, draws } = mockGpu(undefined, packDagSelection(collected.roots));
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
  backend.render(camera());
  await backend.flush?.();
  draws.length = 0;
  backend.render(camera());
  const vis = draws.filter((draw) => draw.indirect);
  assert.ok(vis.length >= 2 && vis.length <= 6);
  assert.equal(
    vis.reduce((n, draw) => n + (draw.instanceCount ?? 0), 0),
    2,
  );
  assert.ok(vis.every((draw) => draw.firstInstance === 0));
  assert.ok(vis.every((draw) => (draw.bindOffset ?? 0) % PAGE_BIND_ALIGN === 0));
  const offsets = new Set(vis.map((draw) => draw.bindOffset ?? 0));
  assert.ok(offsets.has(0));
  assert.deepEqual([...offsets], [0], 'all bins share the original page table');
  assert.ok(
    vis.every((draw) => draw.instanceBuffer && draw.slotOffsetsBuffer),
    'GPU redistribution is bound to the vertex shader',
  );
  backend.dispose();
  geoA.dispose();
  geoB.dispose();
  front.dispose();
  both.dispose();
});

test('webgpu page raster matches the WebGL2 exact-pages triangles', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const context = {
    source,
    metadata,
    indices,
    associations,
    maxResidentPages: 2,
    viewport: [32, 32] as [number, number],
  };
  const webgl = exactPagesBackend(context);
  const webgpu = webgpuPagesBackend({ ...context, gpuDevice: device });
  const cam = camera();
  webgl.render(cam);
  await webgpu.prepare();
  webgpu.render(cam);
  await webgpu.flush?.();
  webgpu.render(cam);
  const expected = rasterPageRecords(webgl, cam, [32, 32]);
  const observed = webgpu.rasterRgba!();
  const image = compareImages(expected, observed);
  assert.equal(image.maxChannelError, 0);
  webgl.dispose();
  webgpu.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu pages refuse an incomplete surface when the visible set exceeds the slot budget', async () => {
  installGpuGlobals();
  const { device, draws } = mockGpu();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 1,
    viewport: [32, 32],
  });
  await assert.rejects(backend.prepare(), /INITIAL_COVERAGE_BUDGET/);
  assert.equal(draws.length, 0);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
