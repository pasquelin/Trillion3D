// `writeConeVolume` reads `faceBasis`, written by `composeFace` (see `sceneLightShadowMath.test.ts` for
// the kernel attachment and its signed zeros) and its own dot product is passed to
// `dotVector3`. This test checks that the public cone output stays identical to that of the
// previous code on rectangles and directions hostile to signed zeros.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeFace, shadowProjection } from './sceneLightShadowMath.ts';
import { writeConeVolume } from './sceneLightShadowVolume.ts';
import {
  referenceComposeFace,
  referenceConeAxisCosine,
  referenceShadowProjection,
} from '../sdk-browser/bench/oracles/socle-math-ombres.ts';

const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [0, -0, 1],
  [-0, 1, -0],
  [0.6, -0.8, 0],
];
const RECTS = [
  Float64Array.from([-1, 1, -1, 1]),
  Float64Array.from([-0, 1, -0, 1]),
  Float64Array.from([0, 0, 0, -0]),
  Float64Array.from([-0.3, 0.3, -0.2, 0.2]),
];

test('writeConeVolume: rectangles and directions hostile to signed zeros — bit-exact against the previous code', () => {
  let compares = 0;
  for (const forward of DIRECTIONS) {
    const eye: [number, number, number] = [0, 0, 0];
    const proj = new Float32Array(16);
    referenceShadowProjection(proj, Math.PI / 2, 10);
    shadowProjection(Math.PI / 2, 10);
    // Compose the face on both sides: `writeConeVolume` and the oracle read the last written basis.
    referenceComposeFace(new Float32Array(16), 0, eye, forward, proj);
    composeFace(new Float32Array(16), 0, eye, forward);
    for (const rect of RECTS) {
      const attendu = new Float32Array(8),
        recu = new Float32Array(8);
      const cone = referenceConeAxisCosine(rect, Math.PI / 4);
      attendu.set(cone, 4);
      writeConeVolume(recu, 0, eye, 10, Math.PI / 4, rect);
      compares++;
      for (let i = 4; i < 8; i++)
        assert.ok(
          Object.is(attendu[i], recu[i]),
          `forward=${forward} rect=${[...rect]} i=${i}: ${attendu[i]} ≠ ${recu[i]}`,
        );
    }
  }
  assert.ok(compares >= 12, `${compares} comparisons, set too small`);
});
