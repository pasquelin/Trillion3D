import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHiz } from './hiz.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('missing compute leaves GPU Hi-Z undefined so the visbuffer cut stays conservative', async () => {
  assert.equal(await createGpuHiz(fakeDevice({ compute: false }).device, 32, 32, 4), undefined);
});

test('a Hi-Z resize replaces the this-frame level-0 depth target', async () => {
  const { device, textures } = fakeDevice();
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

test('with no boxes attached the test encodes nothing, and once attached it clears verdicts', async () => {
  const { device } = fakeDevice();
  const cleared: Array<{ bytes: number }> = [];
  let passes = 0;
  const groups: unknown[] = [];
  const encoder = {
    clearBuffer(_buffer: unknown, _offset: number, size: number) {
      cleared.push({ bytes: size });
    },
    beginComputePass() {
      passes++;
      const setBindGroup = (index: number, group: unknown) => (groups[index] = group);
      return { setPipeline() {}, setBindGroup, dispatchWorkgroups() {}, end() {} };
    },
  } as unknown as GPUCommandEncoder;
  const hiz = await createGpuHiz(device, 33, 19, 2);
  assert.ok(hiz);
  // The partition is not mounted: nothing is tested, so nothing is rejected and nothing is cleared.
  const pages = {} as GPUBuffer;
  assert.equal(hiz.encodeTest(device, encoder, 2, 2, pages), 0);
  assert.deepEqual(cleared, []);
  assert.equal(passes, 0);
  hiz.attach({} as GPUBuffer, {} as GPUBuffer);
  assert.equal(hiz.encodeTest(device, encoder, 2, 2, pages), 2);
  // Rows the frame does not test are cleared first: none keeps a verdict.
  assert.deepEqual(cleared, [{ bytes: 8 }]);
  assert.equal(passes, 1);
  // Group 1 is the page table, whose Hi-Z slot word marks a row never culled.
  const [pagesGroup] = groups.slice(1) as [{ entries: GPUBindGroupEntry[] }];
  assert.deepEqual(pagesGroup.entries, [{ binding: 0, resource: { buffer: pages } }]);
  // Mips the partition reads to express a rectangle in texels: offset then width.
  assert.deepEqual(hiz.levels()[0], { offset: 0, width: 33 });
  assert.equal(hiz.levels().length > 1, true);
  hiz.dispose();
});

test('GPU Hi-Z allocates only the current pyramid and releases it on resize', async () => {
  const { device, buffers, destroyed } = fakeDevice();
  const hiz = await createGpuHiz(device, 16, 16, 4);
  assert.ok(hiz);
  assert.equal(buffers.length, 4);
  const firstPyramid = buffers[3];
  assert.equal(hiz.resize(device, 32, 32), true);
  assert.ok(destroyed.includes(firstPyramid));
  hiz.dispose();
  assert.ok(buffers.every((buffer) => destroyed.includes(buffer)));
});
