// Defect 6's cases: four named witnesses, then a sample of at least 3072 cases over what moves the
// determinant — uniform scale from 1e-3 to 1e-16, anisotropic scale (left out by conformity), large
// local coordinates, an object of realistic world size, and a mirror (negative determinant) on half
// of them.
import assert from 'node:assert/strict';
import { buildCase, type Case } from './inverseTransposeCases.ts';

/** Two triangles of world size 2 turned about X. */
export const turned = (s: number, kind: 'uniform' | 'anisotropic', angleDeg: number) =>
  buildCase({ s, kind, worldSize: 2, axis: [1, 0, 0], angleDeg });

/**
 * The witnesses, in this order:
 *  — the counter-example: a half-turn about X sends the local axis (0,0,1) to (0,0,−1), straight
 *    at the camera, so both triangles face it. Below s ≈ 2.15e-7 (det = s³ < 1e-20) the absolute
 *    threshold kept the LOCAL axis (0,0,1), facing away, and culled the cluster;
 *  — the large scale: the same, s outside the guard's band (det ≫ 1e-20);
 *  — no rotation: the same tiny scale, the local axis already the world one, both triangles facing
 *    away — a cull that is right before as after, and must stay so;
 *  — not conformal: the same rotation and tiny scale, anisotropic — conformity (defect 1) leaves it
 *    out before `inverseTranspose3`, so the cone never culls it.
 */
const WITNESSES: [string, Case][] = [
  ['counter-example', turned(1e-8, 'uniform', 180)],
  ['large scale', turned(1e-3, 'uniform', 180)],
  ['no rotation', turned(1e-8, 'uniform', 0)],
  ['not conformal', turned(1e-8, 'anisotropic', 180)],
];

/** 1e-3 to 1e-6 lie outside the absolute threshold's band (det = s³ ≥ 1e-18): the witnesses of
 *  what must not change. 1e-7 to 1e-16 lie inside; 1e-12 and 1e-16 go past where s³ itself is
 *  denormal in f32, which only the 3×3's normalisation crosses. */
const SCALES = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-12, 1e-16];
/** Scales where `det = ±s³` stays above the absolute 1e-20 threshold: the fix changes nothing. */
export const OUTSIDE_BAND = SCALES.filter((s) => s * s * s >= 1e-20);
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
  [1, -1, 0.5],
];
const ANGLES = Array.from({ length: 12 }, (_, i) => 10 + (i * 160) / 11);

const sample = SCALES.flatMap((s) =>
  (['uniform', 'anisotropic'] as const).flatMap((kind) =>
    [1, 4].flatMap((worldSize) =>
      AXES.flatMap((axis) =>
        ANGLES.flatMap((angleDeg) =>
          [false, true].map((mirrored) =>
            buildCase({ s, kind, worldSize, axis, angleDeg, mirrored }),
          ),
        ),
      ),
    ),
  ),
);
assert.ok(sample.length >= 3072, `sample too small: ${sample.length}`);

/** The witnesses, then the sample. */
export const ALL_CASES = [...WITNESSES.map(([, c]) => c), ...sample];
