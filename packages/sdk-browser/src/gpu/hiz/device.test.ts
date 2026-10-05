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

test('with no boxes attached the test encodes nothing; once attached it dispatches in the open pass', async () => {
  const { device } = fakeDevice();
  let dispatches = 0;
  const groups: unknown[] = [];
  const setBindGroup = (index: number, group: unknown) => (groups[index] = group);
  const open = {
    pass: {
      setPipeline() {},
      setBindGroup,
      dispatchWorkgroups: () => void dispatches++,
    } as unknown as GPUComputePassEncoder,
  };
  const hiz = await createGpuHiz(device, 33, 19, 2);
  assert.ok(hiz);
  // The partition is not mounted: nothing is tested, so nothing is rejected.
  const pages = {} as GPUBuffer;
  assert.equal(hiz.encodeTest(device, open, 2, pages, false), 0);
  assert.equal(dispatches, 0);
  hiz.attach({} as GPUBuffer, {} as GPUBuffer);
  // Nothing to clear and no pass of its own: the partition wrote every row's verdict this frame.
  assert.equal(hiz.encodeTest(device, open, 2, pages, false), 2);
  assert.equal(dispatches, 1);
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

test('each view keeps its own pyramid: a switch allocates nothing and finds its size back', async () => {
  const { device, textures, destroyed } = fakeDevice();
  const hiz = await createGpuHiz(device, 32, 32, 4);
  assert.ok(hiz);
  const main = hiz.swap(undefined);
  assert.deepEqual([hiz.width, hiz.height], [0, 0], 'a new view is sized by its first frame');
  assert.equal(hiz.resize(device, 16, 8), true);
  assert.equal(destroyed.length, 0, 'the main view’s pyramid is kept aside, whole');
  const made = textures.length;
  const side = hiz.swap(main);
  assert.deepEqual([hiz.width, hiz.height, hiz.levels()[0].width], [32, 32, 32]);
  assert.equal(hiz.swap(side), main);
  assert.deepEqual([hiz.width, hiz.height, hiz.levels()[0].width], [16, 8, 16]);
  assert.equal(textures.length, made, 'no pyramid is made again');
  hiz.swap(main)?.destroy();
  hiz.dispose();
});
