// Defect 6's cases: four named witnesses, then a sample of at least 3072 cases over what moves the
// determinant — uniform scale from 1e-3 to 1e-16, anisotropic scale, large
// local coordinates, an object of realistic world size, and a mirror (negative determinant) on half
// of them.
import assert from 'node:assert/strict'
import { buildCase, type Case } from './inverseTransposeCases.ts'

/** Two triangles of world size 2 turned about X. */
export const turned = (s: number, kind: 'uniform' | 'anisotropic', angleDeg: number) =>
  buildCase({ s, kind, worldSize: 2, axis: [1, 0, 0], angleDeg })

/**
 * The witnesses, in this order:
 *  — the counter-example: a half-turn about X at a tiny uniform scale (det = s³ < 1e-20) turns
 *    both triangles to face the camera;
 *  — the large scale: the same, s outside that band (det ≫ 1e-20);
 *  — no rotation: the same tiny scale, both triangles facing away;
 *  — not conformal: the same rotation and tiny scale, anisotropic.
 */
const WITNESSES: [string, Case][] = [
  ['counter-example', turned(1e-8, 'uniform', 180)],
  ['large scale', turned(1e-3, 'uniform', 180)],
  ['no rotation', turned(1e-8, 'uniform', 0)],
  ['not conformal', turned(1e-8, 'anisotropic', 180)],
]

/** 1e-3 to 1e-6 lie outside the absolute threshold's band (det = s³ ≥ 1e-18): the witnesses of
 *  what must not change. 1e-7 to 1e-16 lie inside; 1e-12 and 1e-16 go past where s³ itself is
 *  denormal in f32, which only the 3×3's normalisation crosses. */
const SCALES = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9, 1e-12, 1e-16]
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
  [1, -1, 0.5],
]
const ANGLES = Array.from({ length: 12 }, (_, i) => 10 + (i * 160) / 11)

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
)
assert.ok(sample.length >= 3072, `sample too small: ${sample.length}`)

/** The witnesses, then the sample. */
export const ALL_CASES = [...WITNESSES.map(([, c]) => c), ...sample]
