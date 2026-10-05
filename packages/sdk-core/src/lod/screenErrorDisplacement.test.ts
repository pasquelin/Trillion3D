// The certified screen error (`clusterErrorPixels`, `screenErrorBound.ts`) bounds the true screen
// displacement of every point of a sphere moved by at most ε, after perspective projection, off
// the axis included: over drawn views — rotations, uniform and non-uniform scales — and spheres
// out to the field's edges, the worst displacement a search finds, for each family of moves
// (across the axis, in depth either way, oblique, grazing the near plane), never exceeds it. And
// the bound is monotone: it falls along the ray and grows with the radius.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterErrorPixels } from './screenErrorBound.ts';
import {
  FAMILIES,
  drawCase,
  draws,
  worstDisplacement,
  type DisplacementCase,
} from './screenErrorDisplacement.fixture.ts';

const CASES = 5000;

/** The bound `k` announces with its centre scaled by `along` and its radius by `grow`. */
const announced = (k: DisplacementCase, along = 1, grow = 1) =>
  clusterErrorPixels(
    k.error,
    k.stretch,
    k.centre[0] * along,
    k.centre[1] * along,
    k.centre[2] * along,
    k.radius * grow,
    Math.max(k.fx, k.fy),
    k.near,
  );

for (const family of FAMILIES)
  test(`the announced error bounds every ${family} displacement, and is monotone`, () => {
    const d = draws(0x9e3779b9 ^ FAMILIES.indexOf(family));
    let finite = 0,
      tightest = 0;
    for (let i = 0; i < CASES; i++) {
      const k = drawCase(d, family);
      const bound = announced(k),
        truth = worstDisplacement(d, k, family);
      assert.ok(!(truth > bound), `case ${i}: ${truth} px moved, ${bound} px announced`);
      assert.ok(announced(k, 2) <= bound, `case ${i}: the bound grows along the ray`);
      assert.ok(announced(k, 1, 1.5) >= bound, `case ${i}: the bound shrinks with the radius`);
      if (Number.isFinite(bound)) {
        finite++;
        tightest = Math.max(tightest, truth / bound);
      }
    }
    // The campaign bites: most cases announce a finite bound, and some come close to it.
    assert.ok(finite > CASES / 2, `${finite} finite bounds of ${CASES}`);
    assert.ok(tightest > 0.5, `the closest displacement reaches ${tightest} of its bound`);
  });
