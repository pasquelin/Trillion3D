// #849: the view's light-index pool of the tiles past their list, as the frame metrics carry it.
// A sampled frame whose pool overflowed is named and sizes the pool to what it reserved, within a
// bound per tile; a scene no list can overflow samples no pool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createGpuLightTiles } from './tiles.ts';

const START = (100 * LIGHT_SETTINGS.tileLights) / 4,
  MOST = 100 * LIGHT_SETTINGS.tileLights * 4;

test('the frame metrics carry the sampled pool and count its growths', async () => {
  const fake = fakeDevice();
  Object.assign(fake.device, { features: new Set() });
  const tiles = await createGpuLightTiles(fake.device);
  const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
  const encoder = { ...fake.device.createCommandEncoder(), beginComputePass: () => pass };
  const readback = fake.buffers.find((buffer) => buffer.label?.includes('pool readback'))!;
  const state = fake.buffers.find((buffer) => buffer.label?.includes('pool v1'))!;
  const pools = () => fake.writes.filter((write) => write.buffer === (state as never));
  /** One frame of 160 × 160 pixels (100 tiles) and `count` lights, the GPU's pool state `words`. */
  const frame = async (count: number, at: number, words?: number[]) => {
    tiles.ensure(160, 160, {} as GPUTextureView, fake.buffers[0] as never, count);
    tiles.update(new Float64Array(16), [0, 0, 0], 160, 160);
    tiles.encode(encoder as unknown as GPUCommandEncoder, at);
    if (words) new Uint32Array(readback.getMappedRange()).set(words);
    tiles.submitted();
    await new Promise((settled) => setTimeout(settled));
    return tiles.poolMetrics();
  };
  // A wide view names nothing before a sample returns; the frame opens its pool, nothing reserved.
  tiles.ensure(160, 160, {} as GPUTextureView, fake.buffers[0] as never, 200);
  const opened = tiles.poolMetrics();
  assert.deepEqual(opened, { ...opened, tileLightPoolOverflowed: null, tileLightPoolGrowths: 0 });
  await frame(200, 0, [13000, START, 5000, 1]);
  assert.deepEqual([...pools()[0].data], [13000, START, 0, 0]);
  assert.deepEqual(await frame(200, 15, [13000, 5000, MOST * 3, 1]), {
    tileLightPoolReserved: MOST * 3,
    tileLightPoolCapacity: 5000,
    tileLightPoolOverflowed: true,
    tileLightPoolGrowths: 1,
  });
  // Grown to its bound, then a frame with room says so; a narrow frame samples no pool.
  const calm = await frame(200, 30, [13000, MOST, 900, 0]);
  assert.deepEqual([calm.tileLightPoolOverflowed, calm.tileLightPoolGrowths], [false, 2]);
  const capacities = pools().map((write) => write.data[1]);
  assert.deepEqual(capacities, [START, 5000, MOST]);
  assert.equal((await frame(64, 45)).tileLightPoolReserved, null);
});
