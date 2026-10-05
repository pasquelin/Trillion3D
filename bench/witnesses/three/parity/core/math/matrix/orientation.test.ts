// The reflection rule is now written only once: `matrixWindingCw` replaces
// `matrix.determinant() < 0` on the 4x4 of the lit CPU raster and blend pass.
//
// BOTH VERDICTS COMPARED, word for word:
//   — `matrixWindingCw(m.elements)`: sign of upper-left 3x3 determinant, expanded
//     in f64 by cofactors on the first row (`orientation.ts`);
//   — `m.determinant() < 0`: sign of the complete 4x4 determinant, expanded across sixteen
//     coefficients.
// On an affine world matrix — last row (0, 0, 0, 1) — both determinants are the SAME
// real number: the three cofactors of the last row are multiplied by zero. They are not,
// however, the same floating point calculation, which is where the substitution is visible.
//
// WHAT THIS FILE MEASURES, and what it does not measure. Four populations, 2 400 000 matrices, ZERO
// discarded cases in any: an inconvenient measured case is counted, never removed from population.
//   A. 1 000 000 composed poses (position, rotation, signed scale 1e-3 to 1e3): 0 disagreements.
//   B. 1 000 000 arbitrary affines, including shear: 0 disagreements.
//   C.   200 000 CONSTRUCTED SINGULARS (3rd column = combination of first two): 62 069
//        disagreements, i.e. 31% — the population that the previous summary cited without stating
//        that it was not part of the million. The two claims at the time, "1 000 000
//        matrices, 0 differing verdict" and "disagreements on singulars", concerned two
//        distinct populations; combined in one sentence, they contradicted each other.
//   D.   200 000 flattened scale (one axis exactly zero, what an importer actually produces):
//        0 disagreements — both determinants equal zero exactly, and `0 < 0` is false on both
//        sides.
// What happens to singulars from C in the engine: nothing discards them. `matrixWindingCw` is
// read as is by `visibilityRaster`, `visibilityShadingNormal`, `webgpuPagesWinding` and
// `webgpuBlendDraw` to choose culled face. A rank 2 matrix flattens primitive onto a
// plane that remains VISIBLE: verdict decides which of its two sides is shown, and
// disagreement has an observable consequence. But mathematical determinant of these matrices
// is zero: both implementations only compare rounding noise, and neither is correct
// over the other. The test bounds this noise instead of excusing it — see last test.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { matrixWindingCw } from '../../../../../../../packages/sdk-core/src/math/matrix/orientation.ts';

/** Deterministic sequence: same sweep on every run, on this machine and elsewhere. */
function sequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Conditioning of a pose: |det 3x3| over product of norms of its three columns.
 * 1 for an orthogonal matrix, 0 for a singular, independent of scale. This is the only
 * way to say "this matrix is singular" without reading scale: raw determinant of a
 * rotation with scale 1e-3 is 1e-9 without being degenerate.
 */
function conditioning(e: ArrayLike<number>) {
  const det =
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
    e[1] * (e[4] * e[10] - e[6] * e[8]) +
    e[2] * (e[4] * e[9] - e[5] * e[8]);
  const norm = (a: number, b: number, c: number) => Math.hypot(e[a], e[b], e[c]);
  const product = norm(0, 1, 2) * norm(4, 5, 6) * norm(8, 9, 10);
  return product > 0 ? Math.abs(det) / product : 0;
}

/** A population: `n` matrices filled by `fill`, both verdicts counted on each. */
function sweep(n: number, seed: number, fill: (m: THREE.Matrix4, s: () => number) => void) {
  const next = sequence(seed);
  const m = new THREE.Matrix4();
  const tally = { n, cw: 0, disagreements: 0, worstDisagreement: 0, worstAgreement: 1 };
  for (let i = 0; i < n; i++) {
    fill(m, next);
    const cw = matrixWindingCw(m.elements);
    const reference = m.determinant() < 0;
    const conditioned = conditioning(m.elements);
    if (cw) tally.cw++;
    if (cw === reference) tally.worstAgreement = Math.min(tally.worstAgreement, conditioned);
    else {
      tally.disagreements++;
      tally.worstDisagreement = Math.max(tally.worstDisagreement, conditioned);
    }
  }
  return tally;
}

const position = new THREE.Vector3(),
  rotation = new THREE.Quaternion(),
  scaling = new THREE.Vector3(),
  euler = new THREE.Euler();

/** Position, rotation and signed scale from 1e-3 to 1e3: instances, mirrors and imported models. */
function composedPose(m: THREE.Matrix4, s: () => number, flatAxis: number | null = null) {
  position.set((s() - 0.5) * 2e3, (s() - 0.5) * 2e3, (s() - 0.5) * 2e3);
  euler.set((s() - 0.5) * 6.3, (s() - 0.5) * 6.3, (s() - 0.5) * 6.3);
  rotation.setFromEuler(euler);
  const axisScale = () => (s() < 0.5 ? -1 : 1) * Math.pow(10, (s() - 0.5) * 6);
  scaling.set(axisScale(), axisScale(), axisScale());
  if (flatAxis !== null) scaling.setComponent(flatAxis, 0);
  m.compose(position, rotation, scaling);
}

test('the rule is the sign of the 3x3 determinant, not a scale reading', () => {
  const identity = new THREE.Matrix4();
  assert.equal(matrixWindingCw(identity.elements), false);
  // A single inverted axis flips orientation; two restore it.
  const oneMirror = new THREE.Matrix4().makeScale(1, -1, 1);
  assert.equal(matrixWindingCw(oneMirror.elements), true);
  const twoMirrors = new THREE.Matrix4().makeScale(-1, -1, 1);
  assert.equal(matrixWindingCw(twoMirrors.elements), false);
  // A rotation flips nothing, regardless of accompanying translation.
  const turned = new THREE.Matrix4()
    .makeRotationY(1.2)
    .premultiply(new THREE.Matrix4().makeTranslation(9, -4, 3));
  assert.equal(matrixWindingCw(turned.elements), false);
});

test('A — 1 000 000 composed poses: no verdict separates, no case discarded', () => {
  const tally = sweep(1_000_000, 20260916, (m, s) => composedPose(m, s));
  assert.equal(tally.disagreements, 0, `${tally.disagreements} disagreements on ${tally.n} poses`);
  assert.ok(tally.cw > 4e5 && tally.cw < 6e5, 'sweep must contain both verdicts');
  // No composed pose of non-zero scales is singular: nothing to discard, nothing discarded.
  assert.ok(tally.worstAgreement > 1e-3, `unexpected quasi-singular pose: ${tally.worstAgreement}`);
});

test('B — 1 000 000 arbitrary affines, shear included: no verdict separates', () => {
  // Last row of world matrix does not weigh: linear part alone decides.
  const tally = sweep(1_000_000, 7, (m, s) => {
    for (let col = 0; col < 4; col++)
      for (let row = 0; row < 4; row++)
        m.elements[col * 4 + row] =
          col === 3 ? (row === 3 ? 1 : (s() - 0.5) * 1e3) : row === 3 ? 0 : s() - 0.5;
  });
  assert.equal(
    tally.disagreements,
    0,
    `${tally.disagreements} disagreements on ${tally.n} affines`,
  );
  assert.ok(tally.cw > 4e5 && tally.cw < 6e5, 'sweep must contain both verdicts');
  // Sampling reaches down to 1e-7 conditioning without separating both implementations.
  assert.ok(
    tally.worstAgreement < 1e-6,
    `sampling too mild: worst agreement at ${tally.worstAgreement}`,
  );
});

test('D — 200 000 flattened scales, one axis exactly zero: both verdicts are false', () => {
  const tally = sweep(200_000, 1234, (m, s) => composedPose(m, s, Math.floor(s() * 3)));
  assert.equal(
    tally.disagreements,
    0,
    `${tally.disagreements} disagreements on ${tally.n} flattened`,
  );
  // Both determinants equal zero exactly: 0 < 0 is false, so no flip.
  assert.equal(tally.cw, 0, 'a zero scale matrix must not flip any orientation');
});

// C — population separating the two implementations, counted and bounded, never discarded. A 3x3 whose
// third column is a linear combination of the first two is singular by construction: its
// real determinant is zero, and both implementations only compare their own rounding noise.
// What must remain true, and what this test holds: disagreement NEVER exceeds noise. Beyond
// conditioning of 1e-15 — 1000 times f64 epsilon — both verdicts are
// always in agreement, so no matrix the engine can still display under a determined side
// changes face when switching implementations.
test('C — 200 000 constructed singulars: disagreement stays below rounding noise', () => {
  const tally = sweep(200_000, 99, (m, s) => {
    const c1 = [s() - 0.5, s() - 0.5, s() - 0.5];
    const c2 = [s() - 0.5, s() - 0.5, s() - 0.5];
    const a = (s() - 0.5) * 4,
      b = (s() - 0.5) * 4;
    m.identity();
    for (let k = 0; k < 3; k++) {
      m.elements[k] = c1[k];
      m.elements[4 + k] = c2[k];
      m.elements[8 + k] = a * c1[k] + b * c2[k];
      m.elements[12 + k] = (s() - 0.5) * 1e3;
    }
  });
  // Disagreement exists: state it and count it, rather than building a population that avoids it.
  assert.ok(
    tally.disagreements > 5e4,
    `population must remain the one separating both implementations: ${tally.disagreements}`,
  );
  assert.ok(
    tally.worstDisagreement < 1e-15,
    `disagreement at ${tally.worstDisagreement} conditioning: no longer rounding ` +
      'noise, both implementations separate on a matrix the engine can display',
  );
});
