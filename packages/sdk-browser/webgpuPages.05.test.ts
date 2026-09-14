import test from 'node:test';
import assert from 'node:assert/strict';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('webgpu pages never publish an incomplete initial cover', async () => {
  installGpuGlobals();
  const { device, draws } = mockGpu();
  const { source, metadata, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await backend.prepare();
  backend.render(camera());
  assert.equal(
    draws.filter((draw) => draw.entryPoint === 'vis_vs' || draw.entryPoint === 'vs').length,
    0,
  );
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  assert.equal(backend.metrics().clusters, 2);
  assert.equal(backend.metrics().residentPages, 0);
  assert.equal(backend.metrics().coverageReady, false);
  assert.equal(draws.length, 0);
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  await backend.flush();
  backend.render(camera());
  assert.equal(backend.metrics().coverageReady, true);
  assert.equal(backend.metrics().residentPages, 2);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu pages prepare without resident bytes and stream the visible set', async () => {
  installGpuGlobals();
  const { device, draws } = mockGpu();
  const { source, metadata, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices: new Map(),
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await backend.prepare();
  backend.render(camera());
  assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1']);
  assert.equal(
    draws.filter((draw) => draw.entryPoint === 'vis_vs' || draw.entryPoint === 'vs').length,
    0,
  );
  backend.acceptPage?.('0', new Uint32Array([0, 1, 2]));
  backend.acceptPage?.('1', new Uint32Array([0, 2, 3]));
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  assert.equal(backend.metrics().residentPages, 2);
  assert.equal(
    draws.filter((draw) => draw.entryPoint === 'vis_vs').reduce((n, d) => n + d.vertexCount, 0),
    6,
  );
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu pages without a device fail prepare so the explorer can keep the Three.js path', async () => {
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    maxResidentPages: 2,
    viewport: [32, 32],
  });
  await assert.rejects(backend.prepare(), /WEBGPU_UNAVAILABLE/);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('the direct WebGPU fallback uses the scene background supplied by its host', async () => {
  installGpuGlobals();
  const { device, passes } = mockGpu(undefined, undefined, false, true);
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    clearColor: 0x2d4059,
  });
  await backend.prepare();
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  const clear = passes.findLast(
    (pass) => pass.colorLoad === 'clear' && pass.formats[0] === 'rgba8unorm',
  )?.colorClear;
  assert.deepEqual(clear, { r: 0x2d / 255, g: 0x40 / 255, b: 0x59 / 255, a: 1 });
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('the visibility-buffer path also clears with the host scene background', async () => {
  installGpuGlobals();
  const { device, passes } = mockGpu();
  const { source, metadata, indices, associations, geometry, material } = quadScene();
  const backend = webgpuPagesBackend({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    clearColor: 0x2d4059,
  });
  await backend.prepare();
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  const clears = passes
    .filter((pass) => pass.colorLoad === 'clear' && pass.formats[0] === 'rgba8unorm')
    .map((pass) => pass.colorClear);
  assert.ok(clears.length > 0);
  assert.ok(
    clears.some(
      (clear) =>
        JSON.stringify(clear) ===
        JSON.stringify({ r: 0x2d / 255, g: 0x40 / 255, b: 0x59 / 255, a: 1 }),
    ),
  );
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
