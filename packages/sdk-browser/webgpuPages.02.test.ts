import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera } from './webgpuPagesTestScenes.ts';

test('trace failure diagnostics retain bounded stack and cause context', async () => {
  installGpuGlobals();
  const events: Array<{ phase: string; message: string; context: Record<string, unknown> }> = [];
  const fixture = quadScene(),
    { device } = mockGpu();
  const backend = webgpuPagesBackend({
    ...fixture,
    indices: new Map(),
    readPage: async () => {
      throw new Error('PAGE_STREAM_FAILED', { cause: new Error('NETWORK_ROOT') });
    },
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  } as never);
  try {
    await assert.rejects(backend.prepare(), /PAGE_STREAM_FAILED/);
    await Promise.resolve();
    const failure = events.find((event) => event.phase === 'coverage-bootstrap-failed');
    assert.ok(failure);
    assert.match(String(failure.context.stack), /Error: PAGE_STREAM_FAILED/);
    assert.match(String(failure.context.cause), /NETWORK_ROOT/);
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('texture uploads obey the per-frame source-byte budget, and a flush settles the whole queue', async () => {
  installGpuGlobals();
  const { device } = mockGpu();
  const fixture = quadScene();
  const color = new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2),
    normal = new THREE.DataTexture(new Uint8Array(16).fill(128), 2, 2);
  const rough = new THREE.DataTexture(new Uint8Array(16).fill(64), 2, 2),
    emissive = new THREE.DataTexture(new Uint8Array(16).fill(32), 2, 2);
  const material = new THREE.MeshStandardMaterial({
    map: color,
    normalMap: normal,
    roughnessMap: rough,
    emissiveMap: emissive,
  });
  fixture.source.children[0].material = material;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    maxTextureTransferBytesPerFrame: 16,
  });
  try {
    // One layer per frame is the budget a render is allowed to spend; it advances by exactly one.
    await backend.prepare();
    assert.equal(backend.metrics().textureUploaded, 1);
    assert.equal(backend.metrics().texturePending, 3);
    // The readiness barrier drains the rest, so two renders of one camera cannot differ because a
    // material layer landed between them.
    backend.render(camera());
    await backend.flush();
    assert.equal(backend.metrics().texturePending, 0);
    assert.equal(backend.metrics().textureUploaded, 4);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
    material.dispose();
    color.dispose();
    normal.dispose();
    rough.dispose();
    emissive.dispose();
  }
});

test('vis pipeline layout stores the page table at binding 2', async () => {
  installGpuGlobals();
  const { device, layouts } = mockGpu();
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
  const visLayout = layouts.find(
    (layout) =>
      layout.entries.some((entry) => entry.binding === 4 && entry.buffer?.type === 'uniform') &&
      layout.entries.some(
        (entry) => entry.binding === 2 && entry.buffer?.type === 'read-only-storage',
      ),
  );
  assert.ok(visLayout);
  assert.equal(
    visLayout.entries.find((entry) => entry.binding === 2)?.buffer?.type,
    'read-only-storage',
  );
  assert.equal(visLayout.entries.find((entry) => entry.binding === 4)?.buffer?.type, 'uniform');
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('vis draws instance each packed page from the page table', async () => {
  installGpuGlobals();
  const { device, draws } = mockGpu();
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
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  const instances = new Set(draws.map((draw) => draw.firstInstance));
  assert.ok(instances.has(0));
  assert.ok(instances.has(1));
  backend.dispose();
  geometry.dispose();
  material.dispose();
});

test('webgpu map atlas is a Chrome copyExternalImageToTexture destination', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
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
  const atlas = textures.find((texture) => texture.depthOrArrayLayers > 1);
  assert.ok(atlas);
  const need =
    GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  assert.equal((atlas.usage ?? 0) & need, need);
  backend.dispose();
  geometry.dispose();
  material.dispose();
});
