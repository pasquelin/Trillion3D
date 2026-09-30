import test from 'node:test';
import assert from 'node:assert/strict';
import { packSurface, intersectSurface, intersectSphere } from './intersections.ts';

test('a fully spatial skew panel recovers a normal ray through its physical center', () => {
  const packed = new Float64Array(15);
  packSurface({ origin: [3, 4, 5], u: [2, 3, 4], v: [4, 2, 1] } as any, packed, 0);
  const normal = [-5, 14, -8].map((value) => value / Math.sqrt(285));
  const origin = [6, 6.5, 7.5].map((value, axis) => value + 2 * normal[axis]);
  const ray = new Float64Array([...origin, ...normal.map((value) => -value)]);
  const scratch = new Float64Array(4);
  assert.equal(intersectSurface(packed, 0, ray, 0, 3, scratch), true);
  for (const [index, expected] of [2, 0.5, 0.5, 1].entries())
    assert.ok(Math.abs(scratch[index] - expected) < 1e-12);
});

test('sphere intersections cannot replace an existing nearer surface hit', () => {
  const ray = new Float64Array([0, 0, 0, 0, 0, 1]);
  assert.equal(intersectSphere({ sphere: { center: [0, 0, 5], radius: 1 } } as any, ray, 0, 3), 3);
  assert.equal(
    intersectSphere({ sphere: { center: [0, 0, 0], radius: 1 } } as any, ray, 0, 0.5),
    0.5,
  );
});
