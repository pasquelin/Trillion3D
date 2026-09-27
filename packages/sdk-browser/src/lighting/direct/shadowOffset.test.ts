import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INDEX_MASK } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SHADOW_SAMPLE_WGSL } from './shadowSampleWgsl.ts';

/** Relative error a WGSL f32 division may carry, 2.5 ulp, taken as 3 ulp of the quotient. */
const DIVISION = 3 * 2 ** -23;

/** Whether `floor(n / d)` of the shader lands on the integer quotient however its division rounds:
 *  every f32 within `DIVISION` of `(n + ½) / d` has that floor. */
const exactFloor = (n: number, d: number) => {
  const q = (n + 0.5) / d,
    whole = Math.floor(n / d);
  return Math.floor(q * (1 - DIVISION)) === whole && Math.floor(q * (1 + DIVISION)) === whole;
};

test("shadowOffset's single-precision floors are develop's integer quotients, every input", () => {
  // Every physical page a table word can name, on every pool side up to 2⁹ pages (a side is the
  // atlas' texels over SHADOW_PAGE, a whole number: `atlas.ts`).
  let checked = 0;
  for (let side = 1; side <= 512; side++) {
    const area = side * side;
    for (let phys = 0; phys <= PAGE_INDEX_MASK; phys++) {
      const layer = Math.floor(phys / area),
        local = phys - layer * area;
      if (!exactFloor(phys, area) || !exactFloor(local, side))
        assert.fail(`page ${phys} on a side of ${side}: a floor may miss the quotient`);
      // Products and differences of whole numbers under 2²⁴: exact in f32.
      assert.ok(Math.fround(layer * area) === layer * area && Math.fround(local) === local);
      checked++;
    }
  }
  assert.equal(checked, 512 * (PAGE_INDEX_MASK + 1));
  assert.match(SHADOW_SAMPLE_WGSL, /floor\(\(phys\+0\.5\)\/area\)/);
  assert.match(SHADOW_SAMPLE_WGSL, /floor\(\(local\+0\.5\)\/side\)/);
});

test('a floor without the half is not safe: the proof is not vacuous', () => {
  // `floor(n / d)` alone sits on the integer boundary for every multiple of `d`.
  const unsafe = (n: number, d: number) =>
    Math.floor((n / d) * (1 - DIVISION)) !== Math.floor(n / d);
  assert.ok(unsafe(64, 8) && unsafe(4096, 4096));
});
