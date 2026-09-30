import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectSurface, packSurface } from './intersections.ts';

test('tilted panel intersections combine all three world coordinates and accept corner hits', () => {
  const packed = new Float64Array(15);
  packSurface({ origin: [1, 2, 3], u: [2, 1, 0], v: [0, 2, 2] } as any, packed, 0);
  const scratch = new Float64Array(4);
  const ray = new Float64Array([4, -0.5, 8, -1 / 3, 2 / 3, -2 / 3]);
  assert.equal(intersectSurface(packed, 0, ray, 0, 7, scratch), true);
  for (const [index, value] of [6, 0.5, 0.5, 1].entries())
    assert.ok(Math.abs(scratch[index] - value) < 1e-12);
  packSurface({ origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] } as any, packed, 0);
  for (const [x, y] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ])
    assert.equal(
      intersectSurface(packed, 0, new Float64Array([x, y, 1, 0, 0, -1]), 0, 2, scratch),
      true,
    );
});
