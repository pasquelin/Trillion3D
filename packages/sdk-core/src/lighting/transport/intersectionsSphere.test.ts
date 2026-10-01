import test from 'node:test';
import assert from 'node:assert/strict';
import type { Vec3 } from '../scene/experimentScene.ts';
import { EPSILON, intersectSphere } from './intersections.ts';
import { neighbours } from './intersections.fixture.ts';

test('a sphere stops a ray at its entry, or at its exit from inside or from its surface', () => {
  const sphere = { sphere: { center: [2, 3, 4], radius: 2, roughness: 0 } } as any;
  const hit = (origin: Vec3, direction: Vec3, limit = 20) =>
    intersectSphere(sphere, Float64Array.from([99, ...origin, ...direction]), 1, limit);
  assert.equal(hit([2, 3, 10], [0, 0, -1]), 4);
  assert.equal(hit([8, 3, 4], [-1, 0, 0]), 4);
  assert.equal(hit([2, 9, 4], [0, -1, 0]), 4);
  assert.equal(hit([4, 3, 10], [0, 0, -1]), 6);
  assert.equal(hit([2, 3, 4], [0, 0, 1]), 2);
  assert.equal(hit([2, 3, 6], [0, 0, -1]), 4);
  assert.equal(hit([2, 3, 6], [0, 0, 1]), 20);
});

test('a sphere a ray misses, leaves behind or meets past the limit returns the limit', () => {
  const sphere = { sphere: { center: [2, 3, 4], radius: 2, roughness: 0 } } as any;
  const hit = (origin: Vec3, direction: Vec3, limit = 20) =>
    intersectSphere(sphere, Float64Array.from([...origin, ...direction]), 0, limit);
  assert.equal(hit([5, 3, 10], [0, 0, -1]), 20);
  assert.equal(hit([2, 3, 10], [0, 0, 1]), 20);
  assert.equal(hit([2, 3, 10], [0, 0, -1], 4), 4);
  assert.equal(hit([2, 3, 10], [0, 0, -1], 3), 3);
  assert.equal(intersectSphere({} as any, new Float64Array(6), 0, 7), 7);
});

test('a sphere around the ray origin no larger than the self-intersection distance is never hit', () => {
  for (const radius of [EPSILON / 2, EPSILON]) {
    const tiny = { sphere: { center: [0, 0, 0], radius, roughness: 0 } } as any;
    assert.equal(intersectSphere(tiny, Float64Array.from([0, 0, 0, 0, 0, 1]), 0, 1), 1);
  }
});

test('a sphere entered exactly at the self-intersection distance is met at its exit', () => {
  // A sphere of radius r centred r past that distance: its entry root lands on it to the bit.
  const radius = 2 ** -21;
  const center = [...neighbours(EPSILON + radius, 256)].find((c) => {
    const root = Math.sqrt(c * c - (c * c - radius * radius));
    return c - root === EPSILON;
  });
  assert.ok(center, 'no centre puts the entry exactly at the distance');
  const sphere = { sphere: { center: [0, 0, center], radius, roughness: 0 } } as any;
  const exit = intersectSphere(sphere, Float64Array.from([0, 0, 0, 0, 0, 1]), 0, 1);
  assert.ok(Math.abs(exit - (center + radius)) < 1e-20, `${exit}`);
});
