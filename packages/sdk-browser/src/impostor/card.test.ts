// #1239, #1335: the card quad is the shared sprite basis, not a second builder. The four corners lie in
// the camera plane through the pivot, of half-extent R, and each corner is what `spriteAt` returns
// for the same inputs. Fails on develop: `card.ts` is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { impostorCardCorners } from './card.ts';
import { spriteAt } from '../visibility/shader/spriteWgsl.ts';

/** A projection whose image-plane axes are +x and +y: the corners then read off directly. */
const toClip = new Float64Array([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const PIVOT = [5, 7, 9];
const RADIUS = 2;
const SPRITE = { rotation: 0, sizeAttenuation: true };

test('the four corners are the shared sprite basis at the pivot, half-extent R', () => {
  const out = impostorCardCorners(new Float64Array(12), toClip, PIVOT, RADIUS);
  const expected = [
    [3, 5, 9],
    [7, 5, 9],
    [7, 9, 9],
    [3, 9, 9],
  ];
  for (let i = 0; i < 4; i++)
    assert.deepEqual([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]], expected[i], `corner ${i}`);
  // The centre of the card is the pivot, whatever the radius.
  for (let axis = 0; axis < 3; axis++) {
    const mean = [0, 1, 2, 3].reduce((sum, i) => sum + out[i * 3 + axis], 0) / 4;
    assert.equal(mean, PIVOT[axis], `axis ${axis}`);
  }
});

test('every corner is what a direct spriteAt call returns', () => {
  const out = impostorCardCorners(new Float64Array(12), toClip, PIVOT, RADIUS);
  const place = new Float64Array(16);
  place[0] = place[5] = place[10] = place[15] = 1;
  place[12] = PIVOT[0];
  place[13] = PIVOT[1];
  place[14] = PIVOT[2];
  const sides = [
    [-RADIUS, -RADIUS],
    [RADIUS, -RADIUS],
    [RADIUS, RADIUS],
    [-RADIUS, RADIUS],
  ];
  const point = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    spriteAt(point, toClip, place, sides[i][0], sides[i][1], SPRITE);
    assert.deepEqual([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]], [point[0], point[1], point[2]]);
  }
});
