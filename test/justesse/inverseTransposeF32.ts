// The `inverseTranspose3` kernel from `inverseTransposeWgsl.ts`, replayed in f32 on the JS
// side: same operation order, same rounding on every product and every sum (`Math.fround`),
// same guards. This is the MODEL — it says what the shader must compute, not what it computes.
// What ties it to the actually executed text is measured elsewhere:
// `test/browser/normal-transform-arithmetique.browser.ts` compares, case by case, this model
// to the shipped shader's output in Chromium WebGPU. Without that measurement the model would
// be only a second implementation, free to drift in silence.
//
// Written here rather than in a test: `normalTransform.test.ts` (lighting),
// `gpuDagInverseTranspose.test.ts` (selection) and the browser proof all three read the same
// arithmetic, instead of each holding a copy.

import { SINGULAR_DETERMINANT } from '../../packages/sdk-core/mathSingular.ts';
import type { Vec3, Mat3 } from './vecTypes.ts';

export const f = Math.fround;
export const croix = (a: Vec3, b: Vec3): Vec3 => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];
export const point = (a: Vec3, b: Vec3): number =>
  f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
export const divise = (a: Vec3, t: number): Vec3 => [f(a[0] / t), f(a[1] / t), f(a[2] / t)];
export const norme = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unitaire = (a: Vec3): Vec3 => divise(a, norme(a));

/** Degrees per radian: the criterion is judged in degrees wherever it is read. */
export const DEG = 180 / Math.PI;

/**
 * How far a rendered normal may drift from unit length without being a defect. f32 `normalize`
 * returns `v / length(v)`: each component carries at most a half relative ULP (2⁻²⁴ ≈ 6e-8), the
 * sum of the three squares accumulates on the order of three, and the square root takes half of
 * that — a few 1e-7 in total. `1e-6` leaves five times that margin, and stays far from what a
 * zero vector (norm 0), a NaN (norm NaN) or an un-renormalised normal (here 1e8) would yield.
 * The tolerance is therefore not there to let a doubt through: it separates rounding from defect.
 */
export const TOLERANCE_NORME = 1e-6;

/** A usable direction: three finite components, and not the zero vector. */
export const direction = (v: Vec3): boolean =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && norme(v) > 0;

/**
 * The ORIENTED angle, in radians, between two directions: `atan2` of the cross product over the
 * SIGNED dot product, in f64 and without normalising. It is zero for two identical directions
 * and π for two opposite ones.
 *
 * TWO TRAPS THIS WRITING AVOIDS, AND THAT IT HAS ALREADY LET THROUGH.
 *  — An ABSOLUTE VALUE on the dot product confuses N and −N: a flipped normal — the most common
 *    inverse-transpose defect, and exactly what a surface lit from behind shows — was then
 *    declared correct to zero degrees.
 *  — A ZERO or NON-FINITE vector has no direction, and `atan2(0, 0)` is zero: a normal the shader
 *    had lost passed as identical to the expected one. The result here is `NaN`, which no
 *    `< threshold` comparison accepts.
 * `acos` of the dot product of f32-normalised vectors stays out: it amplifies the norm's rounding
 * error (acos(1−ε) ≈ √(2ε), i.e. 2e-4 rad for a one-ULP f32 ε) and would report a gap where the
 * two vectors are identical to the bit.
 */
export function angleEntre(a: Vec3, b: Vec3): number {
  if (!direction(a) || !direction(b)) return NaN;
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/**
 * The CRITERION of a rendered normal, as an object rather than a number: direction, norm and
 * threshold are three distinct requirements, and a verdict that folds them into an angle lets the
 * first two through. `raison` is `null` when everything holds, otherwise it says WHAT was missing
 * — that is the text a failure message carries. `ecartDeg` is `NaN` as soon as either direction
 * does not exist: never zero, never "conforming by default".
 */
export function verdictNormale(rendue: Vec3, attendue: Vec3, decrocheDeg: number) {
  const n = direction(rendue) ? norme(rendue) : NaN;
  const ecartDeg = angleEntre(rendue, attendue) * DEG;
  const raison = !direction(rendue)
    ? `rendered normal has no direction: [${rendue}]`
    : !direction(attendue)
      ? `expected normal has no direction: [${attendue}]`
      : Math.abs(n - 1) > TOLERANCE_NORME
        ? `norm ${n} instead of 1 within ${TOLERANCE_NORME}: the normal is not unit`
        : ecartDeg < decrocheDeg
          ? null
          : `${ecartDeg}° from [${attendue}], beyond the ${decrocheDeg}° dropout`;
  return { ok: raison === null, ecartDeg, norme: n, raison };
}

/** The upper-left 3×3 of a column-major 4×4 world matrix, as three columns. */
export const colonnes3 = (world: number[]): Mat3 => [
  [world[0], world[1], world[2]],
  [world[4], world[5], world[6]],
  [world[8], world[9], world[10]],
];

/** `mat3x3f(cross(b,c),cross(c,a),cross(a,b)) * v`, in WGSL order. */
export function cofacteur([a, b, c]: Mat3, v: Vec3): Vec3 {
  const [x, y, z] = [croix(b, c), croix(c, a), croix(a, b)];
  return [0, 1, 2].map((k) => f(f(f(x[k] * v[0]) + f(y[k] * v[1])) + f(z[k] * v[2])));
}

/** Absolute threshold from BEFORE defects 6 and 9, in f32: `abs(det)<1e-20` on the raw 3×3. */
export function avantLeLot(m: Mat3, v: Vec3): Vec3 {
  const [a, b, c] = m;
  const det = point(a, croix(b, c));
  if (Math.abs(det) < 1e-20) return v;
  return divise(cofacteur(m, v), det);
}

/**
 * The shipped kernel, in f32: 3×3 divided by the sum of its absolute values before the
 * determinant, then the singular-matrix convention from `inverseTransposeWgsl.ts`. Null, infinite
 * or NaN sum: the kernel zeroes the adjugate, so the product is the zero vector. Normalised
 * determinant under the threshold but non-zero adjugate: the adjugate ALONE, without the
 * `1/(det·t)` factor that would be ±∞ — the cross product of the transformed edges, to 1/t².
 */
export function apresLeLot(m: Mat3, v: Vec3): Vec3 {
  const t = m.reduce((s, col) => f(s + col.reduce((k, x) => f(k + Math.abs(x)), 0)), 0);
  if (!(t > 0) || !Number.isFinite(t)) return [0, 0, 0];
  const n = m.map((col) => divise(col, t));
  const det = point(n[0], croix(n[1], n[2]));
  const porte = cofacteur(n, v);
  if (!(Math.abs(det) > SINGULAR_DETERMINANT)) return porte;
  return divise(porte, f(det * t));
}

/** Kernel `uniteOuZero`: `normalize(v)`, except on a zero or non-finite vector where it returns zero. */
export const uniteOuZero = (a: Vec3): Vec3 => (point(a, a) > 0 ? unitaire(a) : [0, 0, 0]);

/**
 * Lighting-shader `xformNormal(world, n)`: the inverse-transpose of the world 3×3 applied to the
 * local normal, then renormalised. `world` is the column-major 4×4.
 */
export const xformNormalModele = (world: number[], n: Vec3): Vec3 =>
  uniteOuZero(apresLeLot(colonnes3(world), n));

/** The same composition with the pre-batch form, to say what the defect returned. */
export const xformNormalAvantLeLot = (world: number[], n: Vec3): Vec3 =>
  unitaire(avantLeLot(colonnes3(world), n));
