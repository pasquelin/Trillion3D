// The reflection rule is now written only once: `matrixWindingCw` replaces
// `matrix.determinant() < 0` on the 4x4 of the lit CPU raster and blend pass.
//
// BOTH VERDICTS COMPARED, word for word:
//   — `matrixWindingCw(m.elements)`: sign of upper-left 3x3 determinant, expanded
//     in f64 by cofactors on the first row (`matrixOrientation.ts`);
//   — `m.determinant() < 0`: sign of complete 4x4 determinant from Three, expanded across sixteen
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
import { matrixWindingCw } from './matrixOrientation.ts';

/** Deterministic sequence: same sweep on every run, on this machine and elsewhere. */
function tirage(graine: number) {
  let etat = graine >>> 0;
  return () => {
    etat = (Math.imul(etat, 1664525) + 1013904223) >>> 0;
    return etat / 4294967296;
  };
}

/**
 * Conditioning of a pose: |det 3x3| over product of norms of its three columns.
 * 1 for an orthogonal matrix, 0 for a singular, independent of scale. This is the only
 * way to say "this matrix is singular" without reading scale: raw determinant of a
 * rotation with scale 1e-3 is 1e-9 without being degenerate.
 */
function conditionnement(e: ArrayLike<number>) {
  const det =
    e[0] * (e[5] * e[10] - e[6] * e[9]) -
    e[1] * (e[4] * e[10] - e[6] * e[8]) +
    e[2] * (e[4] * e[9] - e[5] * e[8]);
  const norme = (a: number, b: number, c: number) => Math.hypot(e[a], e[b], e[c]);
  const produit = norme(0, 1, 2) * norme(4, 5, 6) * norme(8, 9, 10);
  return produit > 0 ? Math.abs(det) / produit : 0;
}

/** A population: `n` matrices filled by `poser`, both verdicts counted on each. */
function balayage(n: number, graine: number, poser: (m: THREE.Matrix4, s: () => number) => void) {
  const suivant = tirage(graine);
  const m = new THREE.Matrix4();
  const releve = { n, cw: 0, desaccords: 0, pireConditionnementEnDesaccord: 0, pireAccord: 1 };
  for (let i = 0; i < n; i++) {
    poser(m, suivant);
    const cw = matrixWindingCw(m.elements);
    const reference = m.determinant() < 0;
    const conditionne = conditionnement(m.elements);
    if (cw) releve.cw++;
    if (cw === reference) releve.pireAccord = Math.min(releve.pireAccord, conditionne);
    else {
      releve.desaccords++;
      releve.pireConditionnementEnDesaccord = Math.max(
        releve.pireConditionnementEnDesaccord,
        conditionne,
      );
    }
  }
  return releve;
}

const position = new THREE.Vector3(),
  rotation = new THREE.Quaternion(),
  echelle = new THREE.Vector3(),
  euler = new THREE.Euler();

/** Position, rotation and signed scale from 1e-3 to 1e3: instances, mirrors and imported models. */
function poseComposee(m: THREE.Matrix4, s: () => number, aplatir: number | null = null) {
  position.set((s() - 0.5) * 2e3, (s() - 0.5) * 2e3, (s() - 0.5) * 2e3);
  euler.set((s() - 0.5) * 6.3, (s() - 0.5) * 6.3, (s() - 0.5) * 6.3);
  rotation.setFromEuler(euler);
  const taille = () => (s() < 0.5 ? -1 : 1) * Math.pow(10, (s() - 0.5) * 6);
  echelle.set(taille(), taille(), taille());
  if (aplatir !== null) echelle.setComponent(aplatir, 0);
  m.compose(position, rotation, echelle);
}

test('the rule is the sign of the 3x3 determinant, not a scale reading', () => {
  const identite = new THREE.Matrix4();
  assert.equal(matrixWindingCw(identite.elements), false);
  // A single inverted axis flips orientation; two restore it.
  const unMiroir = new THREE.Matrix4().makeScale(1, -1, 1);
  assert.equal(matrixWindingCw(unMiroir.elements), true);
  const deuxMiroirs = new THREE.Matrix4().makeScale(-1, -1, 1);
  assert.equal(matrixWindingCw(deuxMiroirs.elements), false);
  // A rotation flips nothing, regardless of accompanying translation.
  const tournee = new THREE.Matrix4()
    .makeRotationY(1.2)
    .premultiply(new THREE.Matrix4().makeTranslation(9, -4, 3));
  assert.equal(matrixWindingCw(tournee.elements), false);
});

test('A — 1 000 000 composed poses: no verdict separates, no case discarded', () => {
  const releve = balayage(1_000_000, 20260916, (m, s) => poseComposee(m, s));
  assert.equal(releve.desaccords, 0, `${releve.desaccords} disagreements on ${releve.n} poses`);
  assert.ok(releve.cw > 4e5 && releve.cw < 6e5, 'sweep must contain both verdicts');
  // No composed pose of non-zero scales is singular: nothing to discard, nothing discarded.
  assert.ok(releve.pireAccord > 1e-3, `unexpected quasi-singular pose: ${releve.pireAccord}`);
});

test('B — 1 000 000 arbitrary affines, shear included: no verdict separates', () => {
  // Last row of world matrix does not weigh: linear part alone decides.
  const releve = balayage(1_000_000, 7, (m, s) => {
    for (let colonne = 0; colonne < 4; colonne++)
      for (let ligne = 0; ligne < 4; ligne++)
        m.elements[colonne * 4 + ligne] =
          colonne === 3 ? (ligne === 3 ? 1 : (s() - 0.5) * 1e3) : ligne === 3 ? 0 : s() - 0.5;
  });
  assert.equal(releve.desaccords, 0, `${releve.desaccords} disagreements on ${releve.n} affines`);
  assert.ok(releve.cw > 4e5 && releve.cw < 6e5, 'sweep must contain both verdicts');
  // Sampling reaches down to 1e-7 conditioning without separating both implementations.
  assert.ok(releve.pireAccord < 1e-6, `sampling too mild: worst agreement at ${releve.pireAccord}`);
});

test('D — 200 000 flattened scales, one axis exactly zero: both verdicts are false', () => {
  const releve = balayage(200_000, 1234, (m, s) => poseComposee(m, s, Math.floor(s() * 3)));
  assert.equal(releve.desaccords, 0, `${releve.desaccords} disagreements on ${releve.n} flattened`);
  // Both determinants equal zero exactly: 0 < 0 is false, so no flip.
  assert.equal(releve.cw, 0, 'a zero scale matrix must not flip any orientation');
});

// C — population separating the two implementations, counted and bounded, never discarded. A 3x3 whose
// third column is a linear combination of the first two is singular by construction: its
// real determinant is zero, and both implementations only compare their own rounding noise.
// What must remain true, and what this test holds: disagreement NEVER exceeds noise. Beyond
// conditioning of 1e-15 — 1000 times f64 epsilon — both verdicts are
// always in agreement, so no matrix the engine can still display under a determined side
// changes face when switching implementations.
test('C — 200 000 constructed singulars: disagreement stays below rounding noise', () => {
  const releve = balayage(200_000, 99, (m, s) => {
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
    releve.desaccords > 5e4,
    `population must remain the one separating both implementations: ${releve.desaccords}`,
  );
  assert.ok(
    releve.pireConditionnementEnDesaccord < 1e-15,
    `disagreement at ${releve.pireConditionnementEnDesaccord} conditioning: no longer rounding ` +
      'noise, both implementations separate on a matrix the engine can display',
  );
});
