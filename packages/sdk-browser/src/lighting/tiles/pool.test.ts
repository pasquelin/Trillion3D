// #849, #1369: the view's light-index pool of the grid's lists, as the frame metrics carry it. A
// sampled frame whose pool overflowed is named and grows the pool to 1.25 × what it reserved,
// within a bound per column of cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createGpuLightTiles } from './tiles.ts';
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts';

/** 160 × 160 pixels: 3 × 3 columns of cells. */
const COLUMNS = Math.ceil(160 / LIGHT_SETTINGS.tileSize) ** 2;
const START = COLUMNS * LIGHT_SETTINGS.tileLights * 16,
  MOST = START * 16,
  /** Where the pool starts: the cell records, each `TILE_STRIDE_WORDS` wide. */
  RECORDS = COLUMNS * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS;

test('the frame metrics carry the sampled pool and count its growths', async () => {
  const fake = fakeDevice();
  Object.assign(fake.device, { features: new Set() });
  const tiles = await createGpuLightTiles(fake.device);
  const pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
  const encoder = { ...fake.device.createCommandEncoder(), beginComputePass: () => pass };
  const readback = fake.buffers.find((buffer) => buffer.label?.includes('pool readback'))!;
  const state = fake.buffers.find((buffer) => buffer.label?.includes('pool v1'))!;
  const pools = () => fake.writes.filter((write) => write.buffer === (state as never));
  /** One frame of 160 × 160 pixels, the GPU's pool state `words`. */
  const frame = async (at: number, words?: number[]) => {
    tiles.ensure(160, 160, fake.buffers[0] as never);
    tiles.update(new Float64Array(16), [0, 0, 0], 160, 160);
    tiles.encode(encoder as unknown as GPUCommandEncoder, at);
    if (words) new Uint32Array(readback.getMappedRange()).set(words);
    tiles.submitted();
    await new Promise((settled) => setTimeout(settled));
    return tiles.poolMetrics();
  };
  // A view names nothing before a sample returns; the frame opens its pool, nothing reserved.
  tiles.ensure(160, 160, fake.buffers[0] as never);
  const opened = tiles.poolMetrics();
  assert.deepEqual(opened, { ...opened, tileLightPoolOverflowed: null, tileLightPoolGrowths: 0 });
  const asked = START + 1000,
    grown = Math.ceil(asked * 1.25);
  await frame(0, [RECORDS, START, asked, 1]);
  assert.deepEqual([...pools()[0].data], [RECORDS, START, 0, 0]);
  // Grown to 1.25 × what it reserved: a demand risen by less finds room, and no growth follows.
  const risen = Object.values(await frame(15, [RECORDS, grown, asked + 500, 0]));
  assert.deepEqual(
    risen,
    [asked + 500, grown, false, 1],
    'reserved, capacity, overflowed, growths',
  );
  await frame(30, [RECORDS, grown, MOST * 3, 1]);
  // Then grown to its bound.
  assert.equal((await frame(45)).tileLightPoolGrowths, 2);
  const capacities = pools().map((write) => write.data[1]);
  assert.deepEqual(capacities, [START, grown, grown, MOST]);
});
