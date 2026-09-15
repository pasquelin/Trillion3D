import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHiz } from './gpuHiz.ts';
import { hizDevice } from './gpuHizMockDevice.ts';

test('missing compute leaves GPU Hi-Z undefined so the visbuffer cut stays conservative', async () => {
  assert.equal(await createGpuHiz({} as GPUDevice, 32, 32, 4), undefined);
});

test('a Hi-Z resize replaces the this-frame level-0 depth target', async () => {
  const textures: Array<{ format?: string }> = [];
  const device = hizDevice({
    createTexture: ({ format }) => {
      const tex = {
        format,
        destroy() {},
        createView() {
          return { format };
        },
      };
      textures.push(tex);
      return tex;
    },
  });
  const hiz = await createGpuHiz(device, 16, 16, 4);
  assert.ok(hiz);
  const first = hiz.level0;
  assert.equal(hiz.resize(device, 32, 32), true);
  assert.notEqual(hiz.level0, first);
  assert.equal(hiz.width, 32);
  assert.equal(hiz.height, 32);
  assert.ok(textures.filter((texture) => texture.format === 'r32float').length >= 2);
  hiz.dispose();
});

test('GPU Hi-Z encodes a large bound into its reduced level', async () => {
  const writes: Array<{ size: number; data: ArrayBuffer }> = [];
  const device = hizDevice({
    queue: {
      writeBuffer(
        buffer: { size: number },
        _offset: number,
        data: ArrayBuffer,
        _start: number,
        length: number,
      ) {
        writes.push({ size: buffer.size, data: data.slice(0, length) });
      },
    },
  });
  const cleared: Array<{ size: number; bytes: number }> = [];
  const encoder = {
    clearBuffer(buffer: { size: number }, _offset: number, size: number) {
      cleared.push({ size: buffer.size, bytes: size });
    },
    beginComputePass() {
      return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const hiz = await createGpuHiz(device, 33, 19, 2);
  assert.ok(hiz);
  // Flat bounds, and the box answers for row 1: the verdict lands at the row, not at its rank.
  const bounds = new Float64Array([0, 0, 32, 18, 0.8, 0]);
  hiz.encodeTest(device, encoder, bounds, new Uint32Array([1]), 1, 2);
  // The rows the frame does not test are cleared first, so none of them keeps an earlier verdict.
  assert.deepEqual(cleared, [{ size: 8, bytes: 8 }]);
  const write = writes.find((item) => item.size === 64);
  assert.ok(write);
  assert.deepEqual([...new Int32Array(write.data).slice(0, 4)], [0, 0, 8, 4]);
  assert.deepEqual([...new Uint32Array(write.data).slice(5, 8)], [2, 797, 9]);
  hiz.dispose();
});

test('GPU Hi-Z allocates only the current pyramid and releases it on resize', async () => {
  const buffers: Array<{ size: number; destroyed: boolean }> = [];
  const device = hizDevice({
    createBuffer: ({ size }) => {
      const buffer = {
        size,
        destroyed: false,
        destroy() {
          buffer.destroyed = true;
        },
      };
      buffers.push(buffer);
      return buffer;
    },
  });
  const hiz = await createGpuHiz(device, 16, 16, 4);
  assert.ok(hiz);
  assert.equal(buffers.length, 4);
  const firstPyramid = buffers[3];
  assert.equal(hiz.resize(device, 32, 32), true);
  assert.equal(firstPyramid.destroyed, true);
  hiz.dispose();
  assert.ok(buffers.every((buffer) => buffer.destroyed));
});
