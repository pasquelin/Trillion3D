import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { MODE_DEPTH_OCCLUDER, MODE_DEPTH_REST, MODE_ID, rasterEntry } from './gpuRasterContract.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';
import { assertOccluderImage, occluderScene } from './webgpuPagesTestOccluder.ts';
import { cameraMoteur } from './cameraFixture.ts';

test('GPU Hi-Z builds the pyramid between the raster occluder depth and the rest depth', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = occluderScene();
  const viewport: [number, number] = [32, 32];
  const collected = collectClusterPages(source, metadata, indices, associations);
  const { device, computes, textures, draws } = mockGpu(
    undefined,
    packDagSelection(collected.roots),
    false,
    false,
    false,
    true,
  );
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 4,
    viewport,
  });
  const cam = camera();
  const cpu = selectVisiblePages(collected.roots, cameraMoteur(cam), {
    pixelError: 0,
    viewport,
    frame: 1,
  });
  await backend.prepare();
  assert.equal(backend.capabilities.unsupported.includes('occlusion culling'), false);
  assert.ok(textures.some((texture) => texture.format === 'r32float'));
  backend.render(cam);
  await backend.flush();
  draws.length = 0;
  computes.length = 0;
  backend.render(cam);
  // Les deux passes de visibilité matérielles ont disparu avec b72278c6 : la pyramide se bâtit
  // désormais entre deux LANCEMENTS du raster de calcul. L'ordre est le même fait, dit là où il a
  // lieu — profondeur des occulteurs, pyramide, verdict, profondeur du reste, puis identifiants —
  // et il est plus fort que l'ancien, qui ne lisait que les chargements de deux passes.
  const at = (entry: string) => computes.indexOf(entry);
  const occluder = at(rasterEntry('fine', MODE_DEPTH_OCCLUDER)),
    rest = at(rasterEntry('fine', MODE_DEPTH_REST)),
    ids = at(rasterEntry('fine', MODE_ID));
  assert.ok(occluder >= 0 && rest > occluder && ids > rest);
  assert.ok(at('copyDepth') > occluder);
  assert.ok(at('reduceHiz') > at('copyDepth'));
  assert.ok(at('testHiz') > at('reduceHiz'));
  assert.ok(at('testHiz') < rest, 'la moitié testée ne se dessine qu’après son verdict');
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort());
  assertOccluderImage(backend, cpu.shown, cam, viewport);
  assert.equal(draws.filter((draw) => draw.indirect).length, 0);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a successful vis+compact pipeline drops indirect draw from unsupported', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const { device } = mockGpu(
    undefined,
    packDagSelection(collected.roots),
    false,
    false,
    false,
    true,
  );
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
  assert.equal(backend.capabilities.unsupported.includes('indirect draw'), false);
  assert.equal(backend.capabilities.gpuDriven, true);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('a compact pipeline failure keeps the per-page draw loop', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const collected = collectClusterPages(source, metadata, indices, associations);
  const { device, draws } = mockGpu(
    undefined,
    packDagSelection(collected.roots),
    false,
    false,
    false,
    true,
    true,
  );
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
  assert.equal(backend.capabilities.unsupported.includes('indirect draw'), true);
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  assert.equal(draws.filter((draw) => draw.indirect).length, 0);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('normal GPU rendering never copies the image to CPU staging buffers', async () => {
  installGpuGlobals();
  const { device, imageCopies } = mockGpu();
  const fixture = quadScene();
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  try {
    await backend.prepare();
    backend.render(camera());
    await backend.flush?.();
    imageCopies.length = 0;
    for (let i = 0; i < 3; i++) backend.render(camera());
    assert.equal(imageCopies.length, 0, 'beauty must not enqueue image readback');
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
