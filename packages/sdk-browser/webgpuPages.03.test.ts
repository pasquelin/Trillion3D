import test from 'node:test';
import { MANIFEST_IDENTITY } from './pagesBackendFixture.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages, type ClusterManifest } from '../sdk-core/index.ts';
import { exactPagesBackend } from './measurement.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { rasterPageRecords } from './pageRaster.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { drawnPageIds, indirectDraws, installGpuGlobals } from '../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera, mixedBinScene, quadBackend } from './webgpuPagesTestScenes.ts';

test('webgpu pages raster consumes the GPU cache and does not attach a mesh per visible page', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device, draws, writes, computes, buffers } = mockGpu(undefined, packed);
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
    if ((o as THREE.Mesh).isMesh) pageMeshes++;
  });
  assert.equal(pageMeshes, 0);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().selectedTriangles, 2);
  assert.equal(backend.metrics().residentPages, 2);
  assert.ok(writes.length >= 2);
  // The resolve: the material-depth export, then one full-screen triangle per class present —
  // the scene has one material, hence one class.
  const shade = draws.filter((d) => d.entryPoint === 'shade_vs');
  assert.deepEqual(
    shade.map((d) => [d.fragment, d.vertexCount]),
    [
      ['material_depth_fs', 3],
      ['shade_fs', 3],
    ],
  );
  // The hardware raster is the producer of the opaque image: the cut reaches it through the image
  // mask, which its indirect commands consume as instances. The compute raster is not created in
  // production — no binning, no opaque compute capability.
  assert.deepEqual(drawnPageIds(buffers, packed.nodeCount, packed.pageCount), [0, 1]);
  const vis = indirectDraws(draws);
  assert.equal(
    vis.reduce((n, d) => n + (d.instanceCount ?? 0), 0),
    2,
  );
  assert.equal(computes.includes('bin'), false);
  assert.ok(backend.capabilities.unsupported.includes('small-triangle compute raster'));
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), false);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('vis drawIndirect consumes GPU instance indices against one unsorted page table', async () => {
  installGpuGlobals();
  const {
    source,
    metadata: metadataPartial,
    indices,
    associations,
    geoA,
    geoB,
    front,
    both,
  } = mixedBinScene();
  const metadata: ClusterManifest = { ...metadataPartial, ...MANIFEST_IDENTITY };
  const collected = collectClusterPages(source, metadata, indices, associations);
  const packed = packDagSelection(collected.roots);
  const { device, draws, computes, buffers } = mockGpu(undefined, packed);
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
  computes.length = 0;
  backend.render(camera());
  // The two bins — front-only and double-sided — hold two indirect commands on a shared page
  // table, and read the SAME image mask.
  assert.deepEqual(drawnPageIds(buffers, packed.nodeCount, packed.pageCount), [0, 1]);
  assert.equal(computes.includes('bin'), false);
  const vis = indirectDraws(draws);
  assert.ok(vis.length >= 2);
  assert.equal(
    vis.reduce((n, draw) => n + (draw.instanceCount ?? 0), 0),
    2,
  );
  assert.deepEqual([...new Set(vis.map((draw) => draw.bindOffset ?? 0))], [0]);
  assert.ok(vis.every((draw) => draw.instanceBuffer && draw.slotOffsetsBuffer));
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

// Like the reference's root pages, resident outside its pool: a budget smaller than root coverage
// is raised to it, by name, and the image is complete — never refused.
test('a budget under root coverage is raised to it, by name, and the image prepares', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const { fixture, backend } = quadBackend(device, {
    maxResidentPages: 1,
  });
  await backend.prepare();
  const metrics = backend.metrics();
  assert.equal(metrics.geometryPoolClamp, 'root-cover');
  assert.ok((metrics.geometryPoolSlots ?? 0) > 1, 'the slots hold root coverage');
  assert.equal(metrics.coverageReady, true);
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
