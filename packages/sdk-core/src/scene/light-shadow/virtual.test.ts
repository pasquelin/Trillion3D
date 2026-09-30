// The virtual layout both the scheduler and the shaders address pages by: the pool's size against
// the screen, and the finest sun level a view reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shadowPoolSize, shadowPoolShape } from './virtual.ts';
import { finestSunLevel } from './pageModel.ts';

test('the pool holds two frames of four pages a 64-pixel tile while that fits one layer', () => {
  // 1280 × 720: 20 × 12 tiles, four pages each and a third more while pages wait — 1 280 a frame,
  // twice that held, one layer of 51 pages a side.
  assert.equal(shadowPoolSize(1280, 720), 2560);
  assert.deepEqual(shadowPoolShape(2560), { side: 51, layers: 1 });
  assert.ok(
    shadowPoolSize(640, 360) < shadowPoolSize(1280, 720),
    'a smaller screen, a smaller pool',
  );
  assert.equal(shadowPoolSize(1920, 1080), 4096, 'the worst case, as far as one layer holds it');
});

test("the finest sun level is the one whose texel is at most the pixel's near footprint", () => {
  assert.equal(finestSunLevel(1), 0);
  assert.equal(finestSunLevel(0.99), -1);
  assert.equal(finestSunLevel(2 ** -10), -10);
});
