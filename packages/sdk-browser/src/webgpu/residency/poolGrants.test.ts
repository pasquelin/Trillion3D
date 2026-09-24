import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { asWebgpuDevice } from '../../../../../tests/kit/gpu/webgpuDevice.ts';
import { geometryPoolFor } from '../../residency/pools.ts';
import { texturePoolFor } from './memoryBudgets.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { grantedGeometryPool, grantedTexturePool } from './poolGrants.ts';

/** A device that refuses, as out of memory, every buffer or texture past `limit` bytes. */
function refusingDevice(limit: number) {
  const made: Array<{ bytes: number; destroyed: boolean }> = [];
  const resource = (bytes: number) => {
    const entry = { bytes, destroyed: false };
    made.push(entry);
    if (bytes > limit) gpu.raise('Out of memory', { message: 'Out of memory' });
    return { destroy: () => void (entry.destroyed = true), createView: () => ({}) };
  };
  const gpu = asWebgpuDevice({
    limits: {},
    createBuffer: ({ size }: { size: number }) => resource(size),
    createTexture: ({
      size,
    }: {
      size: { width: number; height: number; depthOrArrayLayers: number };
    }) => resource(size.width * size.height * size.depthOrArrayLayers * 4),
  });
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
  installGpuGlobals();
  const { device, made, scopes } = refusingDevice(200);
  const { seen, diagnose } = diagnostics();
  const pool = await grantedGeometryPool(device, 800, geometry, diagnose);
  // 800 → 400 → 200 bytes: the first two refused, the third granted.
  assert.equal(pool?.allocatedBytes, 200);
  assert.deepEqual(
    made.map((entry) => entry.bytes),
    [800, 400, 200],
  );
  assert.ok(
    made.every((entry) => entry.destroyed),
    'every probe is released',
  );
  assert.equal(scopes.length, 0, 'every scope opened is closed');
  assert.deepEqual(seen, [
    { kind: 'warning', pool: 'geometry', requestedBytes: 800, grantedBytes: 200, clamp: null },
  ]);
});

test('a pool granted at once is drawn as asked and says nothing', async () => {
  installGpuGlobals();
  const { device } = refusingDevice(Infinity);
  const { seen, diagnose } = diagnostics();
  assert.equal((await grantedGeometryPool(device, 800, geometry, diagnose))?.allocatedBytes, 800);
  assert.deepEqual(seen, []);
});

test('a pool refused even at its floor is not drawn: the caller keeps what it holds', async () => {
  installGpuGlobals();
  const { device } = refusingDevice(8);
  const { seen, diagnose } = diagnostics();
  // Two root pages of 8 bytes: the floor is 16 bytes, which the device refuses.
  assert.equal(await grantedGeometryPool(device, 800, geometry, diagnose), undefined);
  assert.deepEqual(seen.at(-1), {
    kind: 'warning',
    pool: 'geometry',
    requestedBytes: 800,
    grantedBytes: null,
  });
});

test('a texture pool the device refuses is drawn with fewer layers, down to one per lane', async () => {
  installGpuGlobals();
  const encoding = poolEncoding(null);
  const lanes = { lossless: 20_000, rgba: 0, rg: 0 };
  const poolFor = (bytes: number) =>
    texturePoolFor(bytes, undefined, { color: lanes, data: lanes }, encoding.texelBytes);
  const asked = poolFor(512 * 1024 * 1024);
  const layerBytes = asked.allocatedBytes / (2 * asked.layers.color.lossless);
  // Room for two layers per atlas, not for what the budget asked.
  const { device } = refusingDevice(2 * layerBytes);
  const { seen, diagnose } = diagnostics();
  const pool = await grantedTexturePool(device, 512 * 1024 * 1024, { encoding, poolFor }, diagnose);
  assert.ok(pool && pool.layers.color.lossless <= 2 && pool.layers.color.lossless >= 1);
  assert.ok(pool.allocatedBytes < asked.allocatedBytes);
  assert.equal(seen[0].pool, 'texture');
  assert.equal(seen[0].grantedBytes, pool.allocatedBytes);
});
