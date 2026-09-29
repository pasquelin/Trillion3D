// #1281: `hold.ts` lets a frame hold once the bounce series has closed (`working` false). That loses
// no image only if a closed series writes nothing more: every probe, the surface cache and the
// grid uniform a redraw would read are then the ones the held frame read, so the redraw would
// draw the same pixels. Driven here on the engine's own probes, over a recording device.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { floorProxy } from '../../../sdk-core/src/scene/core/proxy.fixture.ts';
import { createGpuBounceProbes } from './probes.ts';

test('#1281: a closed bounce series encodes and writes nothing: a redraw reads what the held frame read', async () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  });
  const lights = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE });
  const probes = await createGpuBounceProbes(gpu.device, floorProxy(8, 4), () => lights, 1000);
  const work: string[] = [];
  const pass = {
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups: () => void work.push('dispatch'),
    end() {},
  };
  const encoder = {
    copyBufferToBuffer: () => void work.push('copy'),
    clearBuffer: () => void work.push('clear'),
    beginComputePass: () => pass,
  } as unknown as GPUCommandEncoder;
  const eye = [4, 4, 2];
  let frames = 0;
  while (probes.working) {
    assert.ok(++frames < 100_000, 'the series closes');
    probes.encode(encoder, 1, eye);
  }
  assert.ok(work.includes('dispatch'), 'the series traced probes before it closed');
  const writes = gpu.writes.length;
  work.length = 0;
  for (let frame = 0; frame < 8; frame++) assert.equal(probes.encode(encoder, 1, eye), false);
  assert.deepEqual(work, [], 'no pass, copy or clear once closed');
  assert.equal(gpu.writes.length, writes, 'no buffer written once closed');
  assert.equal(probes.working, false);
});
