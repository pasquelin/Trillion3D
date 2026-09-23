import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from '../pages.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { quadScene, camera, quadBackend } from '../testScenes.fixture.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';

test('trace failure diagnostics retain bounded stack and cause context', async () => {
  installGpuGlobals();
  const events: BackendDiagnostic[] = [];
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
    onDiagnostic: (event: BackendDiagnostic) => events.push(event),
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

test('texture queues are pinned at prepare, and a texture that fits in its queue streams nothing', async () => {
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
  (fixture.source.children[0] as THREE.Mesh).material = material;
  const backend = webgpuPagesBackend({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    maxTextureTransferBytesPerFrame: 16,
  }) as WebgpuPagesBackend;
  try {
    // Three queues per atlas — the fill texel and two textures — placed before any image: what
    // the screen shows while no tile is requested.
    await backend.prepare();
    const prepared = backend.metrics();
    assert.equal(prepared.textureTilesResident, 6);
    assert.equal(prepared.textureTilesServed, 0);
    assert.equal(prepared.textureTilesPending, 0);
    // 512 MiB would give each atlas four 63.5 MiB layers; three queues need one, and the pool
    // stops at what the scene can fill, by name.
    assert.equal(prepared.texturePoolLayers, 2, 'one lossless layer per atlas');
    assert.equal(prepared.texturePoolClamp, 'scene');
    // A 2×2 texture fits in its queue: no streamed tile to request, the barrier converges
    // without copying anything, and the pool does not move.
    backend.render(camera());
    await backend.flush();
    const settled = backend.metrics();
    assert.equal(settled.textureTilesResident, 6);
    assert.equal(settled.textureTilesServed, 0);
    assert.equal(settled.textureTilesPending, 0);
    assert.equal(settled.textureTilesRefused, 0);
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
  const { fixture, backend } = quadBackend(device);
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
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('vis draws instance each packed page from the page table', async () => {
  installGpuGlobals();
  const { device, draws } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  backend.render(camera());
  await backend.flush?.();
  backend.render(camera());
  const instances = new Set(draws.map((draw) => draw.firstInstance));
  assert.ok(instances.has(0));
  assert.ok(instances.has(1));
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});

test('texture pools are copy destinations, allocated once at the size the scene fills', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  const pools = textures.filter((texture) => texture.width === 4080 && texture.height === 4080);
  assert.equal(pools.length, 2, 'one colour pool, one data pool');
  const need =
    GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  for (const pool of pools) {
    assert.equal((pool.usage ?? 0) & need, need);
    assert.equal(pool.depthOrArrayLayers, 1);
  }
  assert.deepEqual(pools.map((pool) => pool.format).sort(), ['rgba8unorm', 'rgba8unorm-srgb']);
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
