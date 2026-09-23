import test from 'node:test';
import assert from 'node:assert/strict';
import { mockDrawDevice } from '../../../../../tests/kit/gpu/drawDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createGpuDrawBuffers } from './buffers.ts';
import {
  BASE_SLOTS,
  DRAW_INDIRECT_STRIDE,
  DRAW_ITEM_U32,
  UNIFORM_BYTES,
  WORKGROUP,
  slotCount,
} from './contract.ts';

// Compact buffers depend on the row count (slotCap) and the coplanar-layer count (layerSlots),
// never on the frame: this file pins their sizes and alignments, including the layerSlots = 1
// case which must reproduce the sizes from before layers.

test('createGpuDrawBuffers sizes the item, rest and instance buffers from slotCap alone, for layerSlots = 1', () => {
  installGpuGlobals();
  const { device } = mockDrawDevice();
  const slotCap = 8;
  const buffers = createGpuDrawBuffers(device, slotCap, 1);
  assert.equal(buffers.slots, BASE_SLOTS, 'layerSlots = 1 reproduces the six slots from before');
  assert.equal(buffers.itemsBuf.size, slotCap * DRAW_ITEM_U32 * 4);
  assert.equal(buffers.restBuf.size, Math.max(4, Math.ceil(slotCap / 32) * 4));
  assert.equal(buffers.uniforms.size, UNIFORM_BYTES);
  assert.equal(buffers.instanceBuffer.size, slotCap * 4);
  assert.equal(buffers.indirectBuffer.size, BASE_SLOTS * DRAW_INDIRECT_STRIDE);
  assert.equal(buffers.slotUsedBuf.size, BASE_SLOTS * 4);
  assert.equal(buffers.all.length, 8, 'every allocated buffer is disposed through `all`');
});

test('the indirect, group and slotUsed buffers grow with layerSlots; the item, rest and instance buffers do not', () => {
  installGpuGlobals();
  const slotCap = 20;
  const sizesFor = (layerSlots: number) => {
    const { device } = mockDrawDevice();
    return createGpuDrawBuffers(device, slotCap, layerSlots);
  };
  const one = sizesFor(1),
    three = sizesFor(3);
  assert.equal(three.slots, slotCount(3));
  assert.equal(
    one.itemsBuf.size,
    three.itemsBuf.size,
    'items depend on slotCap, not the layer count',
  );
  assert.equal(one.restBuf.size, three.restBuf.size);
  assert.equal(one.instanceBuffer.size, three.instanceBuffer.size);
  assert.equal(one.uniforms.size, three.uniforms.size);
  assert.equal(three.indirectBuffer.size, slotCount(3) * DRAW_INDIRECT_STRIDE);
  assert.equal(three.slotUsedBuf.size, slotCount(3) * 4);
  const groupCount = Math.ceil(slotCap / WORKGROUP);
  assert.equal(three.groupCounts.size, groupCount * slotCount(3) * 4);
  assert.equal(three.groupOffsets.size, groupCount * slotCount(3) * 4);
  assert.ok(
    three.indirectBuffer.size > one.indirectBuffer.size,
    'three layers name more indirect commands than one',
  );
});

test('every allocated buffer is word-aligned, including an odd slotCap and several layer counts', () => {
  installGpuGlobals();
  for (const slotCap of [1, 3, 17, 65]) {
    for (const layerSlots of [1, 2, 5]) {
      const { device } = mockDrawDevice();
      const buffers = createGpuDrawBuffers(device, slotCap, layerSlots);
      for (const buffer of buffers.all)
        assert.equal(buffer.size % 4, 0, `slotCap=${slotCap} layerSlots=${layerSlots}`);
    }
  }
});

test('slotUsedBuf starts every slot at one: a caller that counts nothing pays the full compaction, exactly like before', () => {
  installGpuGlobals();
  for (const layerSlots of [1, 3]) {
    const { device } = mockDrawDevice();
    const buffers = createGpuDrawBuffers(device, 8, layerSlots);
    const raw = buffers.slotUsedBuf as unknown as { data: Uint8Array };
    assert.deepEqual(
      [...new Uint32Array(raw.data.buffer)],
      new Array(slotCount(layerSlots)).fill(1),
      'every slot starts marked used, so an unmodified caller compacts everything as before',
    );
  }
});
