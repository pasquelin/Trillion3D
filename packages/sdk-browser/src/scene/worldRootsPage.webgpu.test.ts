// #1238: the same world super-root page, read at its world address, becomes a drawable page on
// WebGPU too. Its world-space floats are packed into the engine's float vertex pool as a source
// block, and its `u16` indices — widened to `u32` by the detached source's `read` — land in a GPU
// page slot whole, the three words of one triangle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from '../../../../tests/kit/gpu/globals.ts';
import { fakeDevice, replayWrites } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { createVertexPool } from '../webgpu/core/geometryPrepare.ts';
import { createGpuPageCache } from '../gpu/page/pages.ts';
import { worldRootsPageFixtureSource } from './worldRootsPage.fixture.ts';
import {
  worldRootsAttributes,
  worldRootsBounds,
  worldRootsIndices,
  worldRootsPageAddress,
} from './worldRootsPage.ts';

/** A device that keeps every queue write as `[buffer label, byte offset, floats]`. */
function recordingDevice() {
  const writes: [string, number, number[]][] = [];
  const device = {
    createBuffer: (descriptor: GPUBufferDescriptor) => ({ label: descriptor.label }),
    queue: {
      writeBuffer: (
        buffer: { label?: string },
        offset: number,
        data: Float32Array,
        at = 0,
        size = data.length,
      ) => void writes.push([buffer.label ?? '', offset, [...data.subarray(at, at + size)]]),
    },
  } as unknown as GPUDevice;
  return { device, writes };
}

test('its world positions land in the WebGPU float pool as they are (#1238)', async () => {
  installGpuGlobals();
  const { device, writes } = recordingDevice(),
    address = worldRootsPageAddress('world-roots.bin', 1, 0),
    page = await worldRootsPageFixtureSource().page(address),
    attributes = worldRootsAttributes(page),
    { min, max } = worldRootsBounds(page);
  assert.equal(attributes.position.count, 3, 'three world-space vertices');
  assert.deepEqual([...min, ...max], [1, 0, 0, 2, 1, 0], 'the box is the world-space span');
  const pool = createVertexPool(device, 3, false, new Map());
  pool.pack(new Map([[attributes, false]]));
  const positions = writes.find(([label]) => label.includes('concatPos'));
  assert.deepEqual(
    positions?.[2],
    [1, 0, 0, 2, 0, 0, 1, 1, 0],
    'the cook\u2019s world-space vertices, no pose applied',
  );
});

test('its widened indices land in a GPU page slot as one triangle (#1238)', async () => {
  installGpuGlobals();
  const address = worldRootsPageAddress('world-roots.bin', 2, 0),
    source = worldRootsPageFixtureSource(),
    page = await source.page(address),
    indices = worldRootsIndices(page);
  assert.ok(indices instanceof Uint32Array && indices.length === 3, 'one 32-bit triangle');
  const { device, writes } = fakeDevice({ limits: { maxBufferSize: 64 } }),
    cache = createGpuPageCache(device, source, { pageBytes: 12, slots: 1 }),
    resident = await cache.load(address);
  assert.equal(resident.bytes, 12, 'three index words in the slot');
  const slot = new ArrayBuffer(12);
  replayWrites(slot, writes);
  assert.deepEqual(
    [...new Uint32Array(slot)],
    [0, 1, 2],
    'the slot holds the page\u2019s widened indices, one triangle',
  );
});
