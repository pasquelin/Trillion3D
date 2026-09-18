import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { packDagSelection } from './gpuDagSelection.ts';
import { indirectDraws, installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera, quadBackend } from './webgpuPagesTestScenes.ts';
import { assertOccluderImage, occluderScene } from './webgpuPagesTestOccluder.ts';
import { cameraMoteur } from './cameraFixture.ts';

test('GPU Hi-Z builds the pyramid after the vis occluder pass and loads the disoccluded vis pass', async () => {
  installGpuGlobals();
  const { source, metadata, indices, associations, geometry, material } = occluderScene();
  const viewport: [number, number] = [32, 32];
  const collected = collectClusterPages(source, metadata, indices, associations);
  const { device, passes, computes, textures, draws } = mockGpu(
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
  // Les occulteurs vident la cible, la moitié testée la recharge ; copie de profondeur, réduction
  // puis test, dans cet ordre, entre les deux.
  const visPasses = passes.filter(
    (pass) => pass.label === 'WG visibility primary' || pass.label === 'WG visibility secondary',
  );
  assert.ok(visPasses.length >= 2);
  assert.equal(visPasses[visPasses.length - 2]?.colorLoad, 'clear');
  assert.equal(visPasses[visPasses.length - 2]?.depthLoad, 'clear');
  assert.equal(visPasses[visPasses.length - 1]?.colorLoad, 'load');
  assert.equal(visPasses[visPasses.length - 1]?.depthLoad, 'load');
  const at = (entry: string) => computes.indexOf(entry);
  assert.ok(at('copyDepth') >= 0);
  assert.ok(at('reduceHiz') > at('copyDepth'));
  assert.ok(at('testHiz') > at('reduceHiz'));
  assert.deepEqual(backend.selectedPageIds().sort(), cpu.shown.map((page) => page.url).sort());
  assertOccluderImage(backend, cpu.shown, cam, viewport);
  indirectDraws(draws);
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
  const { fixture, backend } = quadBackend(device);
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
