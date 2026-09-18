import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { webgpuPagesBackend } from './webgpuPages.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { mockGpu } from './webgpuPagesMockGpu.ts';
import { quadScene, camera, quadBackend } from './webgpuPagesTestScenes.ts';

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

test('les queues des textures sont épinglées à la préparation, et une texture qui tient dans sa queue ne diffuse rien', async () => {
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
    // Trois queues par atlas — le texel de remplissage et deux textures —, posées avant toute
    // image : ce que l'écran montre tant qu'aucune tuile n'est demandée.
    await backend.prepare();
    const prepared = backend.metrics();
    assert.equal(prepared.textureTilesResident, 6);
    assert.equal(prepared.textureTilesServed, 0);
    assert.equal(prepared.textureTilesPending, 0);
    assert.equal(prepared.texturePoolLayers, 4, '512 Mio, deux atlas, des couches de 63,5 Mio');
    // Une texture de 2×2 tient dans sa queue : aucune tuile diffusée à demander, la barrière
    // converge sans rien copier, et le pool ne bouge pas.
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

test('les pools de textures sont des destinations de copie, alloués une fois à la taille du budget', async () => {
  installGpuGlobals();
  const { device, textures } = mockGpu();
  const { fixture, backend } = quadBackend(device);
  await backend.prepare();
  const pools = textures.filter((texture) => texture.width === 4080 && texture.height === 4080);
  assert.equal(pools.length, 2, 'un pool couleur, un pool de données');
  const need =
    GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  for (const pool of pools) {
    assert.equal((pool.usage ?? 0) & need, need);
    assert.equal(pool.depthOrArrayLayers, 4);
  }
  assert.deepEqual(pools.map((pool) => pool.format).sort(), ['rgba8unorm', 'rgba8unorm-srgb']);
  backend.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
});
