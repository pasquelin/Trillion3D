// #1238: every world super-root page of the cooked fixture, read at its world address, becomes a
// drawable page on WebGPU too. Its world-space floats are packed into the engine's float vertex
// pool as a source block, and its `u16` indices — widened to `u32` by the detached source's `read`
// — land in a GPU page slot whole, the three words of one triangle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { fakeDevice, replayWrites, written } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createVertexPool } from '../webgpu/core/geometryPool.ts';
import { createGpuPageCache } from '../gpu/page/pages.ts';
import { worldRootsPageFixtureSource } from './worldRootsPage.fixture.ts';
import { worldRootsPageAddress } from './worldPageServe.ts';

test('every page lands in the WebGPU float pool and a page slot as cooked (#1238)', async () => {
  installGpuGlobals();
  const { table, source } = worldRootsPageFixtureSource();
  assert.equal(table.pages.length, 4);
  for (const { bundle, offset } of table.pages) {
    const address = worldRootsPageAddress(table.payload.url, bundle, offset),
      x = bundle; // the fixture's page `bundle` is the triangle at x = bundle
    // Its world positions, packed by the engine's float pool, no pose applied.
    const host = fakeDevice(),
      attributes = await source.attributes(address),
      pool = createVertexPool(host.device, 3, false, new Map());
    assert.equal(attributes.position.count, 3, `page ${bundle}: three world-space vertices`);
    pool.place(attributes);
    const positions = host.writes.filter((write) => write.buffer === pool.concatPos);
    assert.deepEqual(
      positions.flatMap((write) => [...written(write)]),
      [x, 0, 0, x + 1, 0, 0, x, 1, 0],
      `page ${bundle}: the cook’s world-space vertices`,
    );
    // Its widened indices, loaded whole into a GPU page slot through the engine's page cache.
    const gpu = fakeDevice({ limits: { maxBufferSize: 64 } }),
      cache = createGpuPageCache(gpu.device, source, { pageBytes: 12, slots: 1 }),
      resident = await cache.load(address);
    assert.equal(resident.bytes, 12, `page ${bundle}: three index words in the slot`);
    const slot = new ArrayBuffer(12);
    replayWrites(slot, gpu.writes);
    assert.deepEqual([...new Uint32Array(slot)], [0, 1, 2], `page ${bundle}: one 32-bit triangle`);
  }
});
