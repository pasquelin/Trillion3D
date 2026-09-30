import test from 'node:test';
import assert from 'node:assert/strict';
import { intersectSurface, intersectSphere, packSurface } from './intersections.ts';

const surface = { origin: [1, 2, 3], u: [2, 0, 0], v: [1, 2, 0] };
test('skew panel intersections recover physical distance and surface coordinates on both sides', () => {
  const packed = new Float64Array(19).fill(91);
  assert.equal(packSurface(surface as any, packed, 2), true);
  assert.equal(packSurface(surface as any, packed, 2), false);
  assert.deepEqual([...packed.slice(0, 2)], [91, 91]);
  assert.deepEqual([...packed.slice(17)], [91, 91]);
  for (const [origin, direction, front] of [
    [[2.5, 3, 8], [0, 0, -1], 1],
    [[2.5, 3, -2], [0, 0, 1], 0],
  ] as const) {
    const scratch = new Float64Array(4),
      rays = new Float64Array([99, ...origin, ...direction]);
    assert.equal(intersectSurface(packed, 2, rays, 1, 6, scratch), true);
    assert.deepEqual([...scratch], [5, 0.5, 0.5, front]);
    assert.equal(intersectSurface(packed, 2, rays, 1, 5, scratch), false);
  }
  const scratch = new Float64Array(4);
  for (const ray of [
    [0, 3, 8, 0, 0, -1],
    [5, 3, 8, 0, 0, -1],
    [2.5, 1, 8, 0, 0, -1],
    [2.5, 5, 8, 0, 0, -1],
    [2.5, 3, 3, 0, 0, -1],
    [2.5, 3, 8, 0, 0, 1],
    [2.5, 3, 8, 1, 0, 0],
  ])
    assert.equal(intersectSurface(packed, 2, new Float64Array(ray), 0, 20, scratch), false);
  assert.throws(
    () => packSurface({ ...surface, v: [4, 0, 0] } as any, packed, 2),
    (error: any) => error.code === 'INVALID_SCENE' && error.message.includes('degenerate'),
  );
  assert.equal(packSurface({ ...surface, origin: [1, 2, 4] } as any, packed, 2), true);
});

test('sphere intersections distinguish missing blockers, entry, exit, tangent and misses', () => {
  const scene = { sphere: { center: [2, 3, 4], radius: 2 } } as any;
  const hit = (ray: number[], limit = 20) =>
    intersectSphere(scene, new Float64Array([99, ...ray]), 1, limit);
  assert.equal(hit([2, 3, 10, 0, 0, -1]), 4);
  assert.equal(hit([2, 3, 4, 0, 0, 1]), 2);
  assert.equal(hit([4, 3, 10, 0, 0, -1]), 6);
  assert.equal(hit([5, 3, 10, 0, 0, -1]), 20);
  assert.equal(hit([2, 3, 10, 0, 0, 1]), 20);
  assert.equal(hit([2, 3, 10, 0, 0, -1], 4), 4);
  assert.equal(intersectSphere({} as any, new Float64Array(6), 0, 7), 7);
  for (const [origin, direction] of [
    [
      [8, 3, 4],
      [-1, 0, 0],
    ],
    [
      [2, 9, 4],
      [0, -1, 0],
    ],
  ] as const)
    assert.equal(hit([...origin, ...direction]), 4);
});
