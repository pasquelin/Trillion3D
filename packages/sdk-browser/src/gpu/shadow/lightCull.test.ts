import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createGpuDraw } from '../draw/draw.ts';
import { createShadowLightCull } from './lightCull.ts';
import type { DrawnLog } from '../dag/types.ts';

// The light cut's casters reach the shadow pass through ONE cull pass, whatever the views and the
// regions: no per-view list, no compaction, and a width read on the card from the drawn log.
test('the light cull is one pass for every region, sized by the widest drawn log', async () => {
  const { device, writes } = fakeDevice();
  const draw = await createGpuDraw(device, 100_000);
  assert.ok(draw);
  const map = draw.lightRows(4096);
  const buffer = (size = 64) => device.createBuffer({ size, usage: 0 });
  const targets = { kept: buffer(), indirect: buffer(), faces: buffer(), capacity: 1024 };
  const cull = await createShadowLightCull(device, targets);
  const work = buffer();
  const log: DrawnLog = {
    buffer: buffer(),
    offset: 3,
    work,
    offsetWord: 4,
    countWord: 8,
    groupsWord: 12,
  };
  const calls: string[] = [];
  const copies: Array<{ src: unknown; srcOffset: number }> = [];
  let passes = 0;
  const pass = {
    setBindGroup() {},
    setPipeline(pipeline: { entryPoint: string }) {
      calls.push(pipeline.entryPoint);
    },
    dispatchWorkgroups(x: number) {
      calls.push(`direct ${x}`);
    },
    dispatchWorkgroupsIndirect() {
      calls.push('indirect');
    },
    end() {},
  };
  const encoder = {
    beginComputePass: () => (passes++, pass),
    copyBufferToBuffer(src: unknown, srcOffset: number) {
      copies.push({ src, srcOffset });
    },
  } as unknown as GPUCommandEncoder;
  const source = {
    spheres: buffer(),
    mobility: buffer(),
    items: draw.itemsBuffer,
    rowOf: map.rowOf,
    log,
    blendFirst: 100_000,
    blendEnd: 100_008,
    refreshRows: (p: GPUComputePassEncoder) => map.encode(p, 100_000),
  };
  const frame = (regions: number) => {
    calls.length = passes = copies.length = 0;
    cull.encode(encoder, source, regions, 100_000);
  };
  frame(12);
  assert.equal(passes, 1, 'the map refresh and the cull share one pass');
  assert.deepEqual(calls.slice(-2), ['shadowCullLight', 'indirect']);
  assert.deepEqual(copies, [{ src: work, srcOffset: 12 * 4 }], 'the width is the log’s');
  frame(40);
  assert.deepEqual(
    [passes, calls],
    [1, ['shadowCullLight', 'indirect']],
    'forty regions, one dispatch; a still table maps no row again',
  );
  draw.uploadItems(new Uint32Array(5 * 3), 0, 2);
  draw.encode(encoder, 3, 768);
  frame(1);
  assert.deepEqual(calls.slice(0, 2), ['mapRows', 'direct 1'], 'three rewritten rows, one group');
  // #35: a blended cluster's caster row is no draw record's. The host pins its page in the map,
  // and the cull keeps the rows of the blended range as they are.
  map.pin(7, 100_003);
  const pin = writes.at(-1)!;
  assert.deepEqual([pin.buffer, pin.offset, Array.from(written(pin))], [map.rowOf, 28, [100_003]]);
  frame(1);
  const uni = writes.find((w) => w.data.length === 8 && w.data[3] === 1024)!;
  assert.deepEqual(Array.from(uni.data.subarray(4, 7)), [100_000, 100_000, 100_008]);
});
