import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { compareImages } from '../sdk-core/index.ts';
import { exactPagesBackend } from './index.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { rasterPageRecords } from './pageRaster.ts';
import { collectClusterPages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { MODE_ID, rasterEntry } from './gpuRasterContract.ts';
import { drawnPageIds, installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera, mixedBinScene } from './webgpuPagesTestScenes.ts';

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
    if ((o as THREE.Mesh).isMesh && !(o as THREE.Mesh).userData.blit) pageMeshes++;
  });
  assert.equal(pageMeshes, 0);
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().selectedTriangles, 2);
  assert.equal(backend.metrics().residentPages, 2);
  assert.ok(writes.length >= 2);
  const shade = draws.filter((d) => d.entryPoint === 'shade_vs');
  assert.equal(
    shade.reduce((n, d) => n + d.vertexCount, 0),
    3,
  );
  // Le raster de calcul est le producteur de l'image opaque depuis b72278c6 : la coupe lui arrive
  // par le masque de l'image, et plus aucune commande matérielle ne porte de géométrie — seuls les
  // triangles plein écran de la résolution et de l'ombrage restent.
  assert.deepEqual(drawnPageIds(buffers, packed.nodeCount, packed.pageCount), [0, 1]);
  assert.ok(computes.includes('bin') && computes.includes(rasterEntry('fine', MODE_ID)));
  assert.equal(draws.filter((d) => d.indirect).length, 0);
  assert.ok(draws.every((d) => d.vertexCount === 3));
  assert.equal(backend.capabilities.unsupported.includes('visibility buffer'), false);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('the compute raster reads one unsorted page table for both sided bins', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geoA, geoB, front, both } = mixedBinScene();
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
  // Les deux bacs — face avant seule et double face — tenaient hier deux commandes indirectes sur
  // une table de pages commune. Le raster de calcul n'a plus de bacs : il lit la MÊME table et le
  // MÊME masque pour les deux, en un seul encodage, et le côté se lit sur la ligne de la page.
  assert.deepEqual(drawnPageIds(buffers, packed.nodeCount, packed.pageCount), [0, 1]);
  assert.equal(computes.filter((entry) => entry === 'bin').length, 1);
  assert.equal(draws.filter((draw) => draw.indirect).length, 0);
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
