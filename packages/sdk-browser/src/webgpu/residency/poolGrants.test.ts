import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { geometryPoolFor } from '../../residency/pools.ts';
import { texturePoolFor } from './memoryBudgets.ts';
import { laneCounts, poolEncoding } from '../../texture/blockFormats.ts';
import {
  geometryProbe,
  grantedGeometryPool,
  grantedTexturePool,
  textureProbe,
} from './poolGrants.ts';

/** A device that refuses, as out of memory, every buffer or texture past `limit` bytes. */
function refusingDevice(limit: number) {
  const bytes = ({ size }: GPUBufferDescriptor | GPUTextureDescriptor) => {
    if (typeof size === 'number') return size;
    const { width, height = 1, depthOrArrayLayers = 1 } = size as GPUExtent3DDict;
    return width * height * depthOrArrayLayers * 4;
  };
  const gpu = fakeDevice({
    limits: {},
    refuse: (descriptor) => (bytes(descriptor) > limit ? 'oom' : undefined),
  });
  const made = () =>
    [...gpu.buffers, ...gpu.textures].map((resource) => ({
      bytes: bytes(resource as GPUBufferDescriptor | GPUTextureDescriptor),
      destroyed: gpu.destroyed.includes(resource),
    }));
  return { ...gpu, made };
}

const diagnostics = () => {
  const seen: Array<Record<string, unknown>> = [];
  return {
    seen,
    diagnose: (_phase: string, _message: string, context: Record<string, unknown>) =>
      void seen.push(context),
  };
};

const geometry = (budgetBytes: number) =>
  geometryPoolFor({ budgetBytes, pageBytes: 8, uniquePages: 100, rootPages: 2 });

test('a geometry pool the device refuses is drawn at half its bytes until granted, and said', async () => {
  const { device, made, scopes } = refusingDevice(200);
  const { seen, diagnose } = diagnostics();
  const granted = await grantedGeometryPool(device, 800, geometry, diagnose, geometryProbe(device));
  // 800 → 400 → 200 bytes: the first two refused, the third granted.
  assert.equal(granted?.pool.allocatedBytes, 200);
  assert.deepEqual(
    made().map((entry) => [entry.bytes, entry.destroyed]),
    [
      [800, true],
      [400, true],
      [200, false],
    ],
    'what the device refused is released; what it granted is kept, allocated once',
  );
  assert.equal(scopes.length, 0, 'every scope opened is closed');
  assert.deepEqual(seen, [
    { kind: 'warning', pool: 'geometry', requestedBytes: 800, grantedBytes: 200, clamp: null },
  ]);
});

test('a refused geometry pool halves its slots, never the vertex buffers held beside them', async () => {
  const { device } = refusingDevice(200);
  const { diagnose } = diagnostics();
  const held = (budgetBytes: number) =>
    geometryPoolFor({ budgetBytes, pageBytes: 8, uniquePages: 100, rootPages: 2, heldBytes: 400 });
  const probe = geometryProbe(device);
  const granted = await grantedGeometryPool(device, 1200, held, diagnose, probe, 400);
  // 800 → 400 → 200 bytes of slots, beside the 400 held: not straight down to the root cover.
  assert.deepEqual([granted?.pool.allocatedBytes, granted?.pool.clamp], [200, null]);
});

test('a pool granted at once is drawn as asked and says nothing', async () => {
  const { device } = refusingDevice(Infinity);
  const { seen, diagnose } = diagnostics();
  const probe = geometryProbe(device);
  const granted = await grantedGeometryPool(device, 800, geometry, diagnose, probe);
  assert.equal(granted?.pool.allocatedBytes, 800);
  assert.deepEqual(seen, []);
});

test('a pool refused even at its floor is not drawn: the caller keeps what it holds', async () => {
  const { device } = refusingDevice(8);
  const { seen, diagnose } = diagnostics();
  // Two root pages of 8 bytes: the floor is 16 bytes, which the device refuses.
  const probe = geometryProbe(device);
  assert.equal(await grantedGeometryPool(device, 800, geometry, diagnose, probe), undefined);
  assert.deepEqual(seen.at(-1), {
    kind: 'warning',
    pool: 'geometry',
    requestedBytes: 800,
    grantedBytes: null,
  });
});

test('a texture pool the device refuses is drawn with fewer layers, down to one per lane', async () => {
  const encoding = poolEncoding(undefined);
  const lanes = { ...laneCounts(), lossless: 20_000 };
  const poolFor = (bytes: number) =>
    texturePoolFor(bytes, undefined, { color: lanes, data: lanes }, encoding.texelBytes);
  const asked = poolFor(512 * 1024 * 1024);
  const layerBytes = asked.allocatedBytes / (2 * asked.layers.color.lossless);
  // Room for two layers per atlas, not for what the budget asked.
  const { device } = refusingDevice(2 * layerBytes);
  const { seen, diagnose } = diagnostics();
  const probe = textureProbe(device, encoding);
  const pool = (await grantedTexturePool(device, 512 * 1024 * 1024, { poolFor }, diagnose, probe))
    ?.pool;
  assert.ok(pool && pool.layers.color.lossless <= 2 && pool.layers.color.lossless >= 1);
  assert.ok(pool.allocatedBytes < asked.allocatedBytes);
  assert.equal(seen[0].pool, 'texture');
  assert.equal(seen[0].grantedBytes, pool.allocatedBytes);
});
