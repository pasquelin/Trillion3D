// G8: `sunCascadeOf` only remakes cascade bounds (`sunCascadeSplits`, four `Math.pow`)
// if the view or the split have changed since the last call, instead of remaking them on every face.
// Oracle: the version from before batch G, which always remade them, copied as-is into
// `bench/oracles/soleil-cascades.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunCascadeOf } from './sceneLightSunCascades.ts';
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

const AXIS: [number, number, number] = [0.1, -0.9, 0.4];

// `boxRadius` left the cascade with the per-page shadows batch: the reject volume is now
// computed from the box half-sides, so a region of it can be taken. The oracle,
// for its part, remains the frozen copy from before; we therefore compare the fields the cascade still publishes.
function memeCascade(v: ShadowViewpoint, index: number, side: number, label: string) {
  const { center, radius, boxCenter } = sunCascadeOf(v, AXIS, index, side);
  const reference = referenceSunCascadeOf(v, AXIS, index, side);
  assert.deepEqual(
    { center: [...center], radius, boxCenter: [...boxCenter] },
    {
      center: [...reference.center],
      radius: reference.radius,
      boxCenter: [...reference.boxCenter],
    },
    label,
  );
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

test('a tiny, zero or negative side does not make the texel grid diverge', () => {
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
