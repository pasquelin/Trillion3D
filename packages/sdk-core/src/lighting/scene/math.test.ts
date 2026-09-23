// Batch F, F20: `length` (math.ts) and the facet-normal length
// (../transport/validation.ts) are the same formula, moved from spreading arguments
// (`Math.hypot(...v)`) to three positional arguments. The F20 item on `multiply4`
// (../../scene/light-shadow/faces.ts) has no object: the shadow batch, on develop, rewrote that file and
// dropped the function before this worktree rebased onto it. The oracle is the implementation from
// before batch F, copied as-is into `oracles/vecteurs-transport.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cross, length } from './math.ts';
import { validateScene } from '../transport/validation.ts';
import { sceneWithBlocker } from '../../../../../tests/fixtures/lightingTransportScene.ts';
import { referenceLength } from '../../../../../bench/oracles/core/vecteurs-transport.ts';
import { referenceCross } from '../../../../../bench/oracles/browser/socle-math.ts';
import type { Vec3 } from './types.ts';

test('length returns exactly Math.hypot(...v) on hostile vectors', () => {
  const vecteurs: Vec3[] = [
    [0, 0, 0],
    [-0, -0, -0],
    [1, 0, 0],
    [NaN, 0, 0],
    [Infinity, -Infinity, 0],
    [1e308, 1e308, 1e308],
    [-3, 4, 0],
    [Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE],
  ];
  for (const v of vecteurs)
    assert.ok(
      Object.is(length(v), referenceLength(v)),
      `length(${v}) = ${length(v)} ≠ reference ${referenceLength(v)}`,
    );
});

test('validateScene still accepts a facet normal at the tolerance limit (1e-6)', () => {
  // `../transport/validation.ts` calls the same formula as `length` on `patch.normal`: a
  // scene that is already valid, with unit normals by construction, must still pass.
  const scene = sceneWithBlocker(true, 1);
  assert.doesNotThrow(() => validateScene(scene));
  for (const patch of scene.patches)
    assert.ok(
      Object.is(length(patch.normal), referenceLength(patch.normal)),
      `length of the normal of patch ${patch.id}`,
    );
});

// `cross` moved from an inlined cross product to `crossVector3` of the math kernel.
// The formula is identical term by term (no sum started at zero on one side only), so no signed-zero
// regression is expected here, unlike the matrix × matrix products tested in
// `../../scene/light-shadow/math.test.ts` and `streamingPriority.test.ts`.
test('cross returns exactly the previous cross product, signed zeros included', () => {
  const vecteurs: Vec3[] = [
    [1, 0, 0],
    [0, -0, 1],
    [-0, 0, -0],
    [3, -4, 0],
    [Infinity, -Infinity, 0],
    [NaN, 1, 1],
  ];
  for (const a of vecteurs)
    for (const b of vecteurs) {
      const recu = cross(a, b),
        attendu = referenceCross(a, b);
      for (let i = 0; i < 3; i++)
        assert.ok(
          Object.is(recu[i], attendu[i]),
          `cross(${a}, ${b})[${i}] = ${recu[i]} ≠ ${attendu[i]}`,
        );
    }
});
