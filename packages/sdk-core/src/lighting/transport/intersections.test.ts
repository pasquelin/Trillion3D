import test from 'node:test';
import assert from 'node:assert/strict';
import type { Surface, Vec3 } from '../scene/experimentScene.ts';
import { neighbours } from './intersections.fixture.ts';
import { LIGHTING_TRANSPORT_LIMITS } from './limits.ts';
import { EPSILON, SURFACE_STRIDE, intersectSurface, packSurface } from './intersections.ts';
import { centre, cross, unit } from '../../../../../tests/fixtures/lightingSceneTestHelpers.ts';

const { degenerateGram: DEGENERATE_GRAM, grazing: GRAZING } = LIGHTING_TRANSPORT_LIMITS;
const panel = (origin: Vec3, u: Vec3, v: Vec3) => ({ origin, u, v }) as Surface;
/** A packed `surface` and its hit test: `[distance, u, v, front]`, or null on a miss. */
function packed(surface: Surface) {
  const buffer = new Float64Array(SURFACE_STRIDE);
  packSurface(surface, buffer, 0);
  return (origin: Vec3, direction: Vec3, limit = Infinity) => {
    const scratch = new Float64Array(4);
    return intersectSurface(
      buffer,
      0,
      Float64Array.from([...origin, ...direction]),
      0,
      limit,
      scratch,
    )
      ? [...scratch]
      : null;
  };
}
const near = (actual: number[] | null, expected: number[]) => {
  assert.ok(actual, `miss, expected ${expected}`);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < 1e-12, `${actual} != ${expected}`),
  );
};

test('packing writes one stride at its offset and reports whether the surface changed', () => {
  const surface = panel([1, 2, 3], [2, 0, 0], [1, 2, 0]);
  const buffer = new Float64Array(SURFACE_STRIDE + 4).fill(91);
  assert.equal(packSurface(surface, buffer, 2), true);
  assert.equal(packSurface(surface, buffer, 2), false);
  assert.deepEqual([...buffer.slice(0, 2), ...buffer.slice(SURFACE_STRIDE + 2)], [91, 91, 91, 91]);
  for (const [key, axis] of [
    ['origin', 0],
    ['u', 1],
    ['v', 2],
  ] as const) {
    const moved = structuredClone(surface);
    moved[key][axis] += 1;
    assert.equal(packSurface(moved, buffer, 2), true, key);
    assert.equal(packSurface(surface, buffer, 2), true, key);
  }
});

test('a rectangle with parallel or empty sides is refused', () => {
  const buffer = new Float64Array(SURFACE_STRIDE);
  for (const v of [
    [4, 0, 0],
    [-1, 0, 0],
    [0, 0, 0],
  ] as Vec3[])
    assert.throws(
      () => packSurface(panel([1, 2, 3], [2, 0, 0], v), buffer, 0),
      (error: any) => error.code === 'INVALID_SCENE' && /degenerate/.test(error.message),
    );
});

test('a skew panel is hit on either side at its distance and its own coordinates', () => {
  const hit = packed(panel([1, 2, 3], [2, 0, 0], [1, 2, 0]));
  near(hit([2.5, 3, 8], [0, 0, -1]), [5, 0.5, 0.5, 1]);
  near(hit([2.5, 3, -2], [0, 0, 1]), [5, 0.5, 0.5, 0]);
  near(hit([1.5, 2.5, 8], [0, 0, -1]), [5, 0.125, 0.25, 1]);
  near(hit([3.5, 3, 4], [0, 0, -2]), [0.5, 1, 0.5, 1]);
});

test('a hit is refused at or past the limit, behind the ray, beside the panel or along it', () => {
  const hit = packed(panel([1, 2, 3], [2, 0, 0], [1, 2, 0]));
  assert.equal(hit([2.5, 3, 8], [0, 0, -1], 5), null);
  assert.ok(hit([2.5, 3, 8], [0, 0, -1], 5 + 1e-9));
  for (const [origin, direction] of [
    [
      [0.9, 3, 8],
      [0, 0, -1],
    ],
    [
      [3.6, 3, 8],
      [0, 0, -1],
    ],
    [
      [2.5, 1.9, 8],
      [0, 0, -1],
    ],
    [
      [2.5, 4.1, 8],
      [0, 0, -1],
    ],
    [
      [1.2, 2.6, 8],
      [0, 0, -1],
    ],
    [
      [3.8, 2.4, 8],
      [0, 0, -1],
    ],
    [
      [2.5, 3, 8],
      [0, 0, 1],
    ],
    [
      [2.5, 3, 3],
      [1, 0, 0],
    ],
    [
      [2.5, 3, 4],
      [1, 0, 0],
    ],
  ] as [Vec3, Vec3][])
    assert.equal(hit(origin, direction), null, `${origin} ${direction}`);
});

test('a hit nearer than the self-intersection distance is refused, one just past it kept', () => {
  const hit = packed(panel([0, 0, 0], [1, 0, 0], [0, 1, 0]));
  assert.equal(hit([0.5, 0.5, EPSILON], [0, 0, -1]), null);
  assert.equal(hit([0.5, 0.5, EPSILON / 2], [0, 0, -1]), null);
  near(hit([0.5, 0.5, EPSILON * 2], [0, 0, -1]), [EPSILON * 2, 0.5, 0.5, 1]);
});

test('edges and corners of a panel belong to it', () => {
  const hit = packed(panel([0, 0, 0], [1, 0, 0], [0, 1, 0]));
  for (const [x, y] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
    [0.5, 0],
    [1, 0.5],
  ])
    near(hit([x, y, 1], [0, 0, -1]), [1, x, y, 1]);
});

test('a ray meeting the panel at the grazing limit hits it; one more grazing, or in its plane, does not', () => {
  // The unit square's normal (u × v) is +z: a direction's grazing measure is its z.
  const hit = packed(panel([0, 0, 0], [1, 0, 0], [0, 1, 0]));
  near(hit([0, 0.5, GRAZING / 2], [1, 0, -GRAZING]), [0.5, 0.5, 0.5, 1]);
  assert.equal(hit([0, 0.5, GRAZING / 4], [1, 0, -GRAZING / 2]), null);
  assert.equal(hit([0, 0.5, 0], [1, 0, 0]), null);
});

test('a rectangle whose Gram determinant is exactly the degenerate limit is refused', () => {
  // u = [a, s, 0] and v = z: the determinant is a² + s², brought to the limit to the bit.
  const [a, s] =
    Array.from({ length: 400 }, (_, i) => (i + 1) * 1e-12)
      .map((a) => [
        a,
        [...neighbours(Math.sqrt(DEGENERATE_GRAM - a * a), 64)].find(
          (side) => a * a + side * side === DEGENERATE_GRAM,
        ),
      ])
      .find(([, side]) => side) ?? [];
  assert.ok(a && s, 'no side reaches the limit exactly');
  const buffer = new Float64Array(SURFACE_STRIDE);
  assert.throws(
    () => packSurface(panel([0, 0, 0], [a, s, 0], [0, 0, 1]), buffer, 0),
    (error: any) => error.code === 'INVALID_SCENE',
  );
  assert.doesNotThrow(() => packSurface(panel([0, 0, 0], [a, s * 2, 0], [0, 0, 1]), buffer, 0));
});

test('a panel spanning all three axes is hit through its centre along its normal', () => {
  for (const [origin, u, v] of [
    [
      [3, 4, 5],
      [2, 3, 4],
      [4, 2, 1],
    ],
    [
      [1, 2, 3],
      [2, 1, 0],
      [0, 2, 2],
    ],
    [
      [-1, 0.5, 2],
      [0, -3, 1],
      [2, 0, 0.5],
    ],
  ] as Vec3[][]) {
    const normal = unit(cross(u, v));
    const middle = centre({ origin, u, v });
    const hit = packed(panel(origin, u, v));
    const front = middle.map((value, axis) => value + 2 * normal[axis]) as Vec3;
    near(hit(front, normal.map((value) => -value) as Vec3), [2, 0.5, 0.5, 1]);
    const back = middle.map((value, axis) => value - 3 * normal[axis]) as Vec3;
    near(hit(back, normal), [3, 0.5, 0.5, 0]);
  }
});
