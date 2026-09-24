import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { asWebgpuDevice } from '../../../../../../tests/kit/gpu/webgpuDevice.ts';
import { quadBackend } from '../testScenes.fixture.ts';
import { setWebgpuMemoryBudgets } from '../io/memory.ts';
import { texturePoolFor } from '../../residency/memoryBudgets.ts';
import { laneCounts, poolEncoding } from '../../../texture/blockFormats.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';

/** The shared test device, refusing as out of memory every `kind` creation whose label holds
 *  `label`. */
function refusing(kind: 'createTexture' | 'createBuffer', label: string) {
  const gpu = mockGpu();
  const device = gpu.device as unknown as Record<string, (d: { label?: string }) => unknown>;
  const make = device[kind];
  device[kind] = function (this: unknown, descriptor: { label?: string }) {
    const made = make.call(this, descriptor);
    if (descriptor.label?.includes(label)) gpu.raise('Out of memory');
    return made;
  };
  return gpu;
}

test('a texture pool refused even at its floor at prepare is refused by name, never allocated in full', async () => {
  installGpuGlobals();
  const { device, textures } = refusing('createTexture', 'texture pool');
  const events: BackendDiagnostic[] = [];
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic: (event: BackendDiagnostic) => events.push(event),
  });
  try {
    await backend.prepare();
    const failure = events.find((event) => event.phase === 'material-pipeline-failed');
    assert.match(String(failure?.context.error), /WEBGPU_TEXTURE_POOL_REFUSED/);
    const pools = textures.filter((texture) =>
      texture.label?.startsWith('Trillion3D texture pool'),
    );
    assert.ok(pools.length > 0);
    assert.ok(
      pools.every((texture) => texture.destroyed),
      'every pool the device refused is released; none is made outside the scope',
    );
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('a geometry pool refused even at its root cover at prepare is refused by name', async () => {
  installGpuGlobals();
  const { device } = refusing('createBuffer', 'geometry page cache');
  const { fixture, backend } = quadBackend(device);
  try {
    await assert.rejects(backend.prepare(), /WEBGPU_GEOMETRY_POOL_REFUSED/);
  } finally {
    backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});

test('the texture budget recorded mid-session is the one the device granted, not the one asked', async () => {
  installGpuGlobals();
  const encoding = poolEncoding(undefined);
  const lanes = { ...laneCounts(), lossless: 20_000 };
  const poolFor = (bytes: number) =>
    texturePoolFor(bytes, undefined, { color: lanes, data: lanes }, encoding.texelBytes);
  const asked = 512 * 1024 * 1024,
    wanted = poolFor(asked);
  const layerBytes = wanted.allocatedBytes / (2 * wanted.layers.color.lossless);
  // Room for two layers per atlas, not for what the budget asks.
  const gpu = asWebgpuDevice({
    limits: {},
    createTexture: ({
      size,
    }: {
      size: { width: number; height: number; depthOrArrayLayers: number };
    }) => {
      if (size.width * size.height * size.depthOrArrayLayers * 4 > 2 * layerBytes)
        gpu.raise('Out of memory', { message: 'Out of memory' });
      return { destroy() {}, createView: () => ({}) };
    },
  });
  const setup = {
    texturePoolBudget: 1,
    texturePools: { encoding, poolFor, pool: poolFor(1) },
  };
  const rt = {
    setup,
    gpu: { device: gpu.device },
    vis: { textures: { color: { pools: [] }, data: { pools: [] }, resize: () => 0 } },
    run: { lost: false, gate: { resourcesChanged() {} } },
    diag: { engineDiagnostic() {} },
  };
  const report = await setWebgpuMemoryBudgets(rt as never, { texturePoolBytes: asked });
  assert.ok(report.texturePool && report.texturePool.budgetBytes < asked);
  assert.equal(setup.texturePoolBudget, report.texturePool.budgetBytes);
});
