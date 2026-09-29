/**
 * The compiler's pre-exposure range cut shows, in eight-bit steps, how far the fixed irradiance
 * floor it bounds to can move a displayed pixel (#958, CMP-16). The cut shortens a light's range
 * where its contribution would fall under `RANGE_CUTOFF_IRRADIANCE` (0.01 W/m²,
 * `asset-compiler-rust/src/compiler_lights.rs`), before exposure and the tone curve, which the
 * compiler does not know. On a Lambert surface of albedo one the most that floor moves an outgoing
 * radiance is `floor / π`; this harness runs that change through the engine's real display chain —
 * the ACES operator and the sRGB transfer exactly as `toneCurveConstants.ts` and
 * `webgl/core/outputGlsl.ts` publish them, parsed, never copied — at exposures 1, 2, 4 and 8.
 *
 * The number is the worst over every base radiance a pixel may hold, so it is the loss the fixed
 * cut cannot avoid; the scene proof (recette) shows how many real pixels reach it. The specular
 * lobe can amplify the same irradiance change further; the range bound holds on the irradiance
 * alone (`asset-compiler-rust/src/compiler_lights/reach.rs`), and the recette's image proof owns it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACES } from './toneCurveConstants.ts';
import { OUTPUT_TRANSFER_GLSL } from '../webgl/core/outputGlsl.ts';

/** Every numeric literal of a shader-text constant, function names stripped so `vec3` is not a 3. */
const numbersIn = (text: string) =>
  [...text.replace(/mat3x3f|vec3f|vec3|bvec3|float/g, '').matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);

/** The nine numbers of a matrix as the constants hold them: column after column. */
const matrix3 = (text: string) => {
  const numbers = numbersIn(text);
  assert.equal(numbers.length, 9, `a matrix of nine numbers: ${text}`);
  return numbers;
};

/** `ACES` holds its fit's numerator and denominator as the expression the shaders evaluate. */
const node = new Function('c', `return (${ACES.numerator});`) as (c: number) => number;
const den = new Function('c', `return (${ACES.denominator});`) as (c: number) => number;

const IN = matrix3(ACES.input.wgsl);
const OUT = matrix3(ACES.output.wgsl);
const EXPOSURE = Number(ACES.exposure);

/** The sRGB transfer's constants, read from the text both engines write: threshold, 1.055,
 *  0.41666, −0.055 and 12.92. */
const SRGB = numbersIn(OUTPUT_TRANSFER_GLSL.match(/linearToSrgb[\s\S]*?low\);/)![0]);
const [, SCALE, , GAMMA, SUB, SLOPE] = SRGB;

/** The fixed floor the cut bounds its irradiance move to, from the compiler's published setting. */
const FLOOR = 1e-2;
/** The largest radiance a Lambert surface of albedo one gives back for that irradiance change. */
const RADIANCE_STEP = FLOOR / Math.PI;

const rows = (m: number[], v: number[]) =>
  [0, 3, 6].map((r) => m[r] * v[0] + m[r + 1] * v[1] + m[r + 2] * v[2]);
const clamp = (x: number) => Math.min(1, Math.max(0, x));
const aces = (c: number[]) =>
  rows(
    OUT,
    rows(
      IN,
      c.map((x) => x / EXPOSURE),
    ).map((x) => node(x) / den(x)),
  ).map(clamp);
const linear = (c: number[]) => c.map(clamp);
const curves = { aces, linear } as const;

const srgb = (x: number) => (x <= SRGB[0] ? SLOPE * x : SCALE * x ** GAMMA + SUB);
const shown = (curve: (c: number[]) => number[], exposure: number, x: number) =>
  srgb(curve([exposure * x, exposure * x, exposure * x])[0]);

/** The largest displayed-channel move, in eight-bit steps, over every base radiance. */
const worstStep = (curve: (c: number[]) => number[], exposure: number) => {
  let worst = 0;
  for (let decade = -9; decade <= 1; decade += 0.001) {
    const x = 10 ** decade;
    const after = Math.max(0, x - RADIANCE_STEP);
    worst = Math.max(
      worst,
      Math.abs(shown(curve, exposure, x) - shown(curve, exposure, after)) * 255,
    );
  }
  return worst;
};

/** The measured worst, per curve and exposure, in eight-bit steps. */
const MEASURED: Record<keyof typeof curves, number[]> = {
  aces: [3.55, 6.93, 13.27, 24.77],
  linear: [10.48, 18.69, 29.64, 44.25],
};
const EXPOSURES = [1, 2, 4, 8];

// Behaviour: the fixed floor moves a displayed pixel by whole steps at every exposure and curve,
// far past the half step the audit's E1 allows; the measured worst confirms the derivation.
for (const curve of Object.keys(curves) as (keyof typeof curves)[])
  for (const [i, exposure] of EXPOSURES.entries())
    test(`the fixed cut loses ${MEASURED[curve][i]} LSB, ${curve} at exposure ${exposure}`, () => {
      const worst = worstStep(curves[curve], exposure);
      assert.ok(worst > 0.5, `${worst} LSB is not the audit's half step`);
      assert.ok(Math.abs(worst - MEASURED[curve][i]) < 0.1, `measured ${worst} LSB`);
    });
