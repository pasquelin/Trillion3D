import test from 'node:test';
import assert from 'node:assert/strict';
import { mockDrawDevice } from '../../../../../tests/kit/gpu/drawDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { createGpuDraw } from './draw.ts';
import type { DrawnLog } from './contract.ts';

// The light compaction walks the pages the light cut drew, never the resident rows: every thread
// it launches is sized by the light's own counters, read on the card, and none by the row count.
test('the light compaction dispatches from the drawn log alone, whatever the resident row count', async () => {
  installGpuGlobals();
  const { device } = mockDrawDevice();
  const draw = await createGpuDraw(device, 100_000);
  assert.ok(draw);
  const light = draw.lightCompaction(4096);
  const buffer = device.createBuffer({ size: 64, usage: 0 }),
    work = device.createBuffer({ size: 64, usage: 0 });
  const log: DrawnLog = { buffer, offset: 3, offsetWord: 4, work, countWord: 5, groupsWord: 6 };
  const calls: string[] = [];
  const copies: Array<{ src: unknown; srcOffset: number }> = [];
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
    beginComputePass: () => pass,
    copyBufferToBuffer(src: unknown, srcOffset: number) {
      copies.push({ src, srcOffset });
    },
  } as unknown as GPUCommandEncoder;
  const frame = () => {
    calls.length = 0;
    copies.length = 0;
    light.encode(encoder, 100_000, 768, log);
  };
  frame();
  assert.deepEqual(copies[0], { src: work, srcOffset: 6 * 4 }, 'the gather is sized by the log');
  frame();
  assert.deepEqual(
    calls,
    [
      'listHead',
      'direct 1',
      'gatherRows',
      'indirect',
      'countGroups',
      'indirect',
      'prefixGroups',
      'direct 1',
      'scatterGroups',
      'indirect',
    ],
    'no pass is sized by the 100,000 resident rows, and a still table maps no row again',
  );
  draw.encode(encoder, new Uint32Array(5 * 3), 3, 0, 2, 768);
  frame();
  assert.deepEqual(calls.slice(0, 2), ['mapRows', 'direct 1'], 'three rewritten rows, one group');
});
