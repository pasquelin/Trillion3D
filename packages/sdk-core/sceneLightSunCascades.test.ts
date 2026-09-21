// G8: `sunCascadeOf` only remakes cascade bounds (`sunCascadeSplits`, four `Math.pow`)
// if the view or the split have changed since the last call, instead of remaking them on every face.
// Oracle: the version from before batch G, which always remade them, copied as-is into
// `bench/oracles/soleil-cascades.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunCascadeOf } from './sceneLightSunCascades.ts';
import { faceFrame } from './sceneLightShadowMath.ts';
import { pageRowsOf } from './sceneLightShadowPages.ts';
import { SHADOW_FACE_SIDES } from './sceneLightShadowAtlas.ts';
import { dotVector3 } from './mathVector.ts';
import { referenceSunCascadeOf } from './bench/oracles/soleil-cascades.mjs';
import type { ShadowViewpoint } from './sceneLightContracts.ts';

function view(overrides: Partial<ShadowViewpoint> = {}): ShadowViewpoint {
  return {
    position: [0, 5, 0],
    forward: [0, 0, -1],
    halfFovY: 0.6,
    aspect: 16 / 9,
    near: 0.1,
    far: 200,
    ...overrides,
  };
}

// Unit, as the store validates it: the extent is reprojected on it below.
const AXIS_LENGTH = Math.hypot(0.1, -0.9, 0.4);
const AXIS: [number, number, number] = [0.1 / AXIS_LENGTH, -0.9 / AXIS_LENGTH, 0.4 / AXIS_LENGTH];

// The oracle predates the page-aligned extent: the two sides share the split cache and the
// frustum sphere, hence the radius, and that is what is compared. The extent itself is proven
// directly: its centre on the page grid of the light plane, within a page of the camera point
// it follows (its own half page plus the oracle's texel snap), and its anchor within one radius
// along the axis.
const right = new Float64Array(3),
  up = new Float64Array(3);
function memeCascade(v: ShadowViewpoint, index: number, side: number, label: string) {
  const { center, radius, pageMetres, originX, originY, anchor } = sunCascadeOf(
    v,
    AXIS,
    index,
    side,
  );
  const reference = referenceSunCascadeOf(v, AXIS, index, side);
  assert.ok(
    Object.is(radius, reference.radius),
    `${label}: radius ${radius} ≠ ${reference.radius}`,
  );
  if (!Number.isFinite(radius) || radius <= 0) return;
  const rows = pageRowsOf(side);
  const expectedPage = rows > 1 ? (2 * radius) / (rows - 1) : 2 * radius;
  assert.ok(Object.is(pageMetres, expectedPage), `${label}: page side`);
  faceFrame(AXIS, right, up);
  const u = dotVector3(center, right),
    w = dotVector3(center, AXIS);
  const tolerance = 1e-9 * Math.max(1, Math.abs(u), Math.abs(w));
  assert.ok(Math.abs(u - (originX + (rows >> 1)) * pageMetres) < tolerance, `${label}: page grid`);
  const down = -dotVector3(center, up);
  assert.ok(
    Math.abs(down - (originY + (rows >> 1)) * pageMetres) < tolerance,
    `${label}: page grid`,
  );
  assert.ok(Math.abs(w - anchor) < tolerance, `${label}: the anchor is the depth of the centre`);
  const followed = reference.center.map((c: number, k: number) => c - center[k]);
  assert.ok(Math.abs(dotVector3(followed, right)) <= pageMetres, `${label}: within a page`);
  assert.ok(Math.abs(dotVector3(followed, up)) <= pageMetres, `${label}: within a page`);
  assert.ok(Math.abs(dotVector3(followed, AXIS)) <= radius + 1e-9, `${label}: within a radius`);
}

test('the four cascades of one view, called in order, match the reference without cache', () => {
  const v = view();
  for (let index = 0; index < 4; index++) memeCascade(v, index, 1024, `cascade ${index}`);
});

test('a distinct view object with the same values still yields a correct result (value cache)', () => {
  const v1 = view();
  memeCascade(v1, 0, 1024, 'first object');
  const v2 = view(); // new object, same fields
  memeCascade(v2, 0, 1024, 'second object, same values');
  memeCascade(v2, 3, 1024, 'second object, last cascade');
});

test('the view changes between two frames: bounds change too, without staying on the old cache', () => {
  memeCascade(view({ far: 200 }), 1, 512, 'far=200');
  memeCascade(view({ far: 50 }), 1, 512, 'far=50, must recompute');
  memeCascade(view({ near: 5 }), 1, 512, 'near=5, must recompute');
  memeCascade(view({ far: 50 }), 1, 512, 'back to far=50');
});

test('a tiny, zero or negative side does not make the page grid diverge', () => {
  const v = view();
  for (const side of [1, 0, -4, 0.0001]) memeCascade(v, 2, side, `side ${side}`);
});

test('-0 and 0 in near/far are not confused by the cache: the result always follows the reference', () => {
  memeCascade(view({ near: 0 }), 0, 800, 'near 0');
  memeCascade(view({ near: -0 }), 0, 800, 'near -0');
  memeCascade(view({ far: -0 }), 0, 800, 'far -0');
});

test('a view with NaN or a degenerate axis breaks nothing and stays identical to the reference', () => {
  memeCascade(view({ far: NaN }), 0, 800, 'far NaN');
  memeCascade(view({ halfFovY: 0 }), 1, 800, 'zero halfFovY');
  memeCascade(view({ aspect: 0 }), 1, 800, 'zero aspect');
});

test('the frustum sphere is contained in the snapped extent, at every published side', () => {
  faceFrame(AXIS, right, up);
  for (const side of SHADOW_FACE_SIDES)
    for (const [x, z] of [
      [0, 0],
      [0.37, -2.9],
      [123.456, 78.9],
      [-51.2, 0.01],
    ])
      for (let index = 0; index < 4; index++) {
        const v = view({ position: [x, 5, z] });
        const { center, radius, halfSide, pageMetres } = sunCascadeOf(v, AXIS, index, side);
        // The oracle's centre is the raw one snapped to a texel: within a texel of the sphere.
        const raw = referenceSunCascadeOf(v, AXIS, index, side).center;
        const texel = (2 * radius) / side;
        const du = Math.abs(dotVector3(raw, right) - dotVector3(center, right)),
          dv = Math.abs(dotVector3(raw, up) - dotVector3(center, up));
        const label = `side ${side}, cascade ${index}, at ${x},${z}`;
        assert.ok(du + radius <= halfSide + texel, `${label}: sphere out of the extent along u`);
        assert.ok(dv + radius <= halfSide + texel, `${label}: sphere out of the extent along v`);
        const rows = pageRowsOf(side);
        assert.ok(Math.abs(halfSide - (rows > 1 ? (rows * pageMetres) / 2 : 2 * radius)) < 1e-9);
      }
});
