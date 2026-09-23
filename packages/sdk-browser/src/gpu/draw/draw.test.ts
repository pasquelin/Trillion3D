import { mockDrawDevice } from '../../../../../tests/kit/gpu/drawDevice.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { packDrawIndirect } from '../../../../sdk-core/src/index.ts';
import {
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  compactSlotLayout,
  createGpuDraw,
  DRAW_INDIRECT_STRIDE,
  DRAW_ITEM_U32,
  DRAW_SHADER,
  evaluateDrawCompact,
  indirectForDraw,
  PAGE_BIND_ALIGN,
  type DrawItem,
} from './draw.ts';
import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts';

test('compact keeps input order inside each bin and writes 16-byte indirects', () => {
  const items = [
    { pageIndex: 4, bin: 0 as const, rest: 0 as const },
    { pageIndex: 1, bin: 1 as const, rest: 0 as const },
    { pageIndex: 7, bin: 0 as const, rest: 0 as const },
  ];
  const result = evaluateDrawCompact(items, 768, 8);
  assert.equal(result.overflow, false);
  assert.deepEqual([...result.instances.subarray(0, 3)], [4, 7, 1]);
  const back = result.indirect.subarray(0, 4);
  assert.deepEqual([...back], [...packDrawIndirect(768, 2)]);
  const none = result.indirect.subarray(4, 8);
  const expectedNone = packDrawIndirect(768, 1);
  expectedNone[3] = 2;
  assert.deepEqual([...none], [...expectedNone]);
});

test('compact overflow sets the flag and writes zero instance counts', () => {
  const items = [{ pageIndex: 0, bin: 0 as const, rest: 0 as const }];
  const result = evaluateDrawCompact(items, 768, 0);
  assert.equal(result.overflow, true);
  assert.equal(result.indirect[1], 0);
});

test('compact rest pass occupies slots 3-5 with exclusive-scan firstInstance', () => {
  const items: DrawItem[] = [
    { pageIndex: 4, bin: BIN_BACK, rest: 0 },
    { pageIndex: 9, bin: BIN_BACK, rest: 1 },
    { pageIndex: 7, bin: BIN_BACK, rest: 0 },
    { pageIndex: 2, bin: BIN_FRONT, rest: 1 },
  ];
  const result = evaluateDrawCompact(items, 768, 8);
  assert.equal(result.overflow, false);
  assert.deepEqual([...result.instances], [4, 7, 9, 2]);
  assert.deepEqual([...result.counts], [2, 0, 0, 1, 0, 1]);
  assert.deepEqual([...result.indirect.subarray(0, 4)], [...packDrawIndirect(768, 2)]);
  const restBack = result.indirect.subarray(3 * 4, 4 * 4);
  const expectedRestBack = packDrawIndirect(768, 1);
  expectedRestBack[3] = 2;
  assert.deepEqual([...restBack], [...expectedRestBack]);
  const restFront = result.indirect.subarray(5 * 4, 6 * 4);
  const expectedRestFront = packDrawIndirect(768, 1);
  expectedRestFront[3] = 3;
  assert.deepEqual([...restFront], [...expectedRestFront]);
  assert.equal(DRAW_INDIRECT_STRIDE, 16);
  assert.equal(BIN_NONE, 1);
});

test('overflow zeros instance counts in every indirect slot', () => {
  const result = evaluateDrawCompact([{ pageIndex: 0, bin: 0, rest: 0 }], 768, 0);
  for (let s = 0; s < 6; s++) assert.equal(result.indirect[s * 4 + 1], 0);
  assert.equal(result.instances.length, 0);
});

test('draw shader counts, prefixes and scatters page groups in parallel with stable order', () => {
  assert.doesNotMatch(DRAW_SHADER, /@compute @workgroup_size\(1\)/);
  assert.match(DRAW_SHADER, /@compute @workgroup_size\(64\)\s*fn countGroups/);
  assert.match(DRAW_SHADER, /@compute @workgroup_size\(64\)\s*fn scatterGroups/);
  assert.match(DRAW_SHADER, /@compute @workgroup_size\(64\)\s*fn prefixGroups/);
  assert.match(DRAW_SHADER, /workgroupBarrier\(\);/);
  assert.doesNotMatch(DRAW_SHADER, /atomicAdd/);
  assert.match(DRAW_SHADER, /restAt\(i\)\s*\*\s*3u\s*\+\s*item\.bin/);
  assert.match(
    DRAW_SHADER,
    /fn restAt\(i:u32\)->u32\{return \(restBits\[i>>5u\]>>\(i&31u\)\)&1u;\}/,
  );
  assert.match(DRAW_SHADER, /indirect\[o\+3u\]=0u/);
});

test('draw consumers zero firstInstance and pad slot binds to 256 bytes', () => {
  const items: DrawItem[] = [
    { pageIndex: 0, bin: BIN_BACK, rest: 0 },
    { pageIndex: 1, bin: BIN_NONE, rest: 0 },
    { pageIndex: 2, bin: BIN_BACK, rest: 1 },
  ];
  const result = evaluateDrawCompact(items, 768, 8);
  assert.equal(result.indirect[3], 0);
  assert.equal(result.indirect[7], 1);
  assert.equal(result.indirect[3 * 4 + 3], 2);
  const drawn = indirectForDraw(result);
  for (let s = 0; s < 6; s++) assert.equal(drawn[s * 4 + 3], 0);
  assert.equal(drawn[1], 1);
  assert.equal(drawn[5], 1);
  assert.equal(drawn[3 * 4 + 1], 1);
  const layout = compactSlotLayout(result.counts, PAGE_INFO_STRIDE);
  assert.equal(PAGE_BIND_ALIGN, 256);
  assert.equal(PAGE_INFO_STRIDE, 256);
  assert.equal(layout.offsets[0], 0);
  assert.equal(layout.offsets[1], 256);
  assert.equal(layout.offsets[3], 512);
  for (const offset of layout.offsets) assert.equal(offset % PAGE_BIND_ALIGN, 0);
  assert.equal(layout.tableRows, 3);
});

test('a device without compute pipelines does not create GPU draw', async () => {
  const device = {
    limits: { maxBufferSize: 1 << 20 },
    createBuffer() {
      throw new Error('should not allocate');
    },
  } as unknown as GPUDevice;
  assert.equal(await createGpuDraw(device, 8), undefined);
  assert.equal(
    await createGpuDraw({ createComputePipeline() {} } as unknown as GPUDevice, 0),
    undefined,
  );
});

test('a compact shader compilation error leaves GPU draw undefined', async () => {
  installGpuGlobals();
  const { device } = mockDrawDevice({ failCompile: true });
  assert.equal(await createGpuDraw(device, 8), undefined);
});

test('GPU draw uploads each item once without a CPU compact and exposes GPU slot offsets', async () => {
  installGpuGlobals();
  const { device, buffers, writes } = mockDrawDevice();
  const gpu = await createGpuDraw(device, 8);
  assert.ok(gpu);
  assert.equal(gpu.indirectBuffer.size, 6 * DRAW_INDIRECT_STRIDE);
  assert.equal(
    gpu.indirectBuffer.usage &
      (GPUBufferUsage.INDIRECT |
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC),
    GPUBufferUsage.INDIRECT |
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  );

  // Packed rows {pageIndex,bin,selectionIndex,layer,triangles}: nothing of the frame enters
  // there, and the occluder/tested half comes from the buffer the GPU partition writes.
  const items = new Uint32Array([4, BIN_BACK, 0, 0, 1, 1, BIN_NONE, 0, 0, 1, 7, BIN_BACK, 0, 0, 1]);
  const encoder = device.createCommandEncoder();
  gpu.encode(encoder, items, 3, 0, 2, 768);
  const itemWrites = writes.filter((write) => write.size === 3 * DRAW_ITEM_U32 * 4).length;
  assert.equal(itemWrites, 1, 'the item rows are uploaded once');
  writes.length = 0;
  gpu.encode(encoder, items, 3, 0, -1, 768);
  assert.equal(
    writes.some((write) => write.size === 3 * DRAW_ITEM_U32 * 4),
    false,
    'an unchanged drawable set re-uploads no item row',
  );
  const indirect = buffers.find((buffer) => buffer.usage & GPUBufferUsage.INDIRECT)!;
  const words = new Uint32Array(
    indirect.data.buffer,
    indirect.data.byteOffset,
    indirect.data.byteLength / 4,
  );
  assert.deepEqual([...words.subarray(0, 4)], [...packDrawIndirect(768, 2)]);
  assert.deepEqual([...words.subarray(4, 8)], [...packDrawIndirect(768, 1)]);
  for (let s = 0; s < 6; s++) assert.equal(words[s * 4 + 3], 0);
  const instances = gpu.instanceBuffer as unknown as { data: Uint8Array };
  const ids = new Uint32Array(
    instances.data.buffer,
    instances.data.byteOffset,
    instances.data.byteLength / 4,
  );
  assert.deepEqual([...ids.subarray(0, 3)], [4, 7, 1]);
  const offsets = gpu.slotOffsetsBuffer as unknown as { data: Uint8Array };
  assert.deepEqual([...new Uint32Array(offsets.data.buffer).subarray(0, 6)], [0, 2, 3, 3, 3, 3]);
  gpu.dispose();
});
