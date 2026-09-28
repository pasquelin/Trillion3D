// #849: the view's light-index pool of the tiles past their list. A sampled frame whose pool
// overflowed is named (`overflowed`) and sizes the pool to what it reserved, within a bound per
// tile; a scene no list can overflow holds no pool at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createTileLightPool } from './pool.ts';

const TILES = 100;

/** Runs one sampled frame whose pool state the GPU left as `state`. */
async function sampleFrame(state: number[], frame: number) {
  const fake = fakeDevice();
  const pool = createTileLightPool(fake.device);
  pool.open(TILES * 130, pool.words(TILES));
  pool.sampleState(fake.device.createCommandEncoder(), frame);
  const readback = fake.buffers.find((buffer) => buffer.label?.includes('readback'))!;
  new Uint32Array(readback.getMappedRange()).set(state);
  pool.submitted();
  await new Promise((settled) => setTimeout(settled));
  return { pool, fake };
}

test('a pool starts at a quarter list a tile, and names nothing before its first sample', () => {
  const pool = createTileLightPool(fakeDevice().device);
  assert.equal(pool.words(TILES), (TILES * LIGHT_SETTINGS.tileLights) / 4);
  assert.equal(pool.sample(), undefined, 'nothing named before a sample returns');
});

test('an overflow is named and grows the pool to what the frame reserved (#849)', async () => {
  const { pool, fake } = await sampleFrame([13000, 1600, 5000, 1], 0);
  // The frame opened its pool, nothing reserved; its state is copied after the pass.
  assert.deepEqual([...fake.writes[0].data], [13000, 1600, 0, 0]);
  assert.equal(fake.copies[0].from, pool.state);
  assert.deepEqual(pool.sample(), { frame: 0, reserved: 5000, capacity: 1600, overflowed: true });
  assert.equal(pool.words(TILES), 5000);
});

test('the pool grows no further than its bound per tile, and a frame with room says so', async () => {
  const most = TILES * LIGHT_SETTINGS.tileLights * 4;
  const { pool } = await sampleFrame([13000, 1600, most * 3, 1], 0);
  assert.equal(pool.words(TILES), most);
  const calm = await sampleFrame([13000, 1600, 900, 0], 0);
  assert.deepEqual(calm.pool.sample(), {
    frame: 0,
    reserved: 900,
    capacity: 1600,
    overflowed: false,
  });
  assert.equal(calm.pool.words(TILES), TILES * 16);
});
