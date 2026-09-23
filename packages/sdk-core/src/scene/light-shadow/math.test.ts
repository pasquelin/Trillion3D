// `composeFace` moved from an inlined 4×4 product (accumulator started at `0`) to
// `multiplyMatrix4`, which starts from no zero: `../../math/matrix/matrix4.test.ts` proves that form can
// yield -0 where the old one always yielded +0. This test checks whether that gap reaches the
// public output of `composeFace`, on directions and eyes hostile to signed zeros; the oracle is the
// previous code, copied as-is into `bench/oracles/browser/core-math-shadows.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFace, shadowOrthographic, shadowProjection } from './math.ts';
import {
  referenceComposeFace,
  referenceShadowOrthographic,
  referenceShadowProjection,
} from '../../../../../bench/oracles/browser/core-math-shadows.ts';

/** The six point axes, then each with its zero components made negative, one by one and
 *  all together: the same hostility as the bench's `POINT_FACE_AXES`. */
const AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
function variantesZeroSigne(axe: readonly [number, number, number]) {
  const variantes: Array<[number, number, number]> = [[...axe]];
  for (let signes = 1; signes < 8; signes++)
    variantes.push(
      axe.map((c, k) => (c === 0 && signes & (1 << k) ? -0 : c)) as [number, number, number],
    );
  return variantes;
}
const YEUX: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [-0, -0, -0],
  [3, -4, 5],
];

test('composeFace: hostile axes and signed zeros, perspective and orthographic — bit-exact against the previous code', () => {
  let compares = 0;
  for (const axe of AXES)
    for (const forward of variantesZeroSigne(axe))
      for (const oeil of YEUX)
        for (const perspective of [true, false]) {
          const proj = new Float32Array(16);
          if (perspective) {
            referenceShadowProjection(proj, Math.PI / 2, 10);
            shadowProjection(Math.PI / 2, 10);
          } else {
            referenceShadowOrthographic(proj, 5, 100);
            shadowOrthographic(5, 100);
          }
          const attendu = new Float32Array(16),
            recu = new Float32Array(16);
          referenceComposeFace(attendu, 0, oeil, forward, proj);
          composeFace(recu, 0, oeil, forward);
          compares++;
          for (let i = 0; i < 16; i++)
            assert.ok(
              Object.is(attendu[i], recu[i]),
              `forward=${forward} eye=${oeil} perspective=${perspective} i=${i}: ${attendu[i]} ≠ ${recu[i]}`,
            );
        }
  assert.ok(compares >= 200, `${compares} comparisons, set too small`);
});

// Batch perf-2: `composeFace` now composes aside (`multiplyMatrix4` without offset) then copies
// its sixteen numbers to `out[base..base+15]`. The test above only covers `base = 0`; the
// real callers (`faces.ts`, `sunFaces.ts`) pack several faces
// in one buffer at non-zero offsets. This test holds the copy: bit-exact against the same
// reference at an arbitrary offset, and nothing written outside the sixteen targeted indices.
test('composeFace: copy at a non-zero offset yields the same bits, without touching the rest of the buffer', () => {
  const BASE = 32; // a third face in a packed-face buffer of sixteen floats each
  const eyes: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0],
    [3, -4, 5],
    [-0, -0, -0],
  ];
  const avants: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ];
  for (const oeil of eyes)
    for (const forward of avants)
      for (const perspective of [true, false]) {
        const proj = new Float32Array(16);
        if (perspective) {
          referenceShadowProjection(proj, Math.PI / 2, 10);
          shadowProjection(Math.PI / 2, 10);
        } else {
          referenceShadowOrthographic(proj, 5, 100);
          shadowOrthographic(5, 100);
        }
        // Filled with a sentinel before the face: both sides start from the same "dirty" buffer, and
        // a gap outside [BASE, BASE+16) — copy shifted by one, overflowing guard — shows it.
        const gardeAttendu = new Float32Array(BASE + 16).fill(7),
          gardeRecu = new Float32Array(BASE + 16).fill(7);
        referenceComposeFace(gardeAttendu, BASE, oeil, forward, proj);
        composeFace(gardeRecu, BASE, oeil, forward);
        for (let i = 0; i < BASE + 16; i++)
          assert.ok(
            Object.is(gardeAttendu[i], gardeRecu[i]),
            `eye=${oeil} forward=${forward} i=${i}: ${gardeAttendu[i]} ≠ ${gardeRecu[i]}`,
          );
      }
});
