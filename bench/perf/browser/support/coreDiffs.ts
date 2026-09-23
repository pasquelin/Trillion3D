// Explained deltas of the foundation bench: where the deposit computes differently from the
// reference, or where the operation itself cannot yield its input. Each delta is quantified
// in the console and bounded by an assertion: it is never read as equality, and never hidden.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SRGBToLinear } from 'three/src/math/ColorManagement.js';
import {
  composeMatrix4,
  decomposeMatrix4,
  determinantMatrix4,
  linearPartDeterminant,
  linearToSrgb,
  srgbToLinear,
} from '../../../../packages/sdk-core/src/index.ts';
import { noeudsHierarchie } from './coreEquivalence.ts';
import { SRGB_REFERENCE_GAP } from '../../../oracles/core/three-duel.ts';

const normeColonne = (m: ArrayLike<number>, c: number) =>
  Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
/** Largest cosine between two linear columns: zero without shear. */
function cisaillement(m: ArrayLike<number>) {
  let pire = 0;
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    const dot = m[a * 4] * m[b * 4] + m[a * 4 + 1] * m[b * 4 + 1] + m[a * 4 + 2] * m[b * 4 + 2];
    pire = Math.max(pire, Math.abs(dot) / (normeColonne(m, a) * normeColonne(m, b)));
  }
  return pire;
}
/** Maximum relative delta between `m` and the recomposition of its decomposition, linear part only. */
function recomposition(m: ArrayLike<number>) {
  const p = new Float64Array(3),
    q = new Float64Array(4),
    s = new Float64Array(3);
  decomposeMatrix4(m, p, q, s);
  const r = composeMatrix4(new Float64Array(16), p, q, s);
  let pire = 0;
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10])
    pire = Math.max(pire, Math.abs(r[i] - m[i]) / normeColonne(m, i >> 2));
  return pire;
}

test('hierarchies: decomposition yields the world matrix without shear, not with', () => {
  const classes: { rigide: number[]; cisaillee: number[]; nonFinie: Float64Array[] } = {
    rigide: [],
    cisaillee: [],
    nonFinie: [],
  };
  for (const { monde } of noeudsHierarchie) {
    const normes = [0, 1, 2].map((c) => normeColonne(monde, c));
    const finie =
      normes.every((n) => Number.isFinite(n) && n > 1e-150 && n < 1e150) &&
      monde.every(Number.isFinite);
    if (!finie) classes.nonFinie.push(monde);
    else
      (cisaillement(monde) < 1e-9 ? classes.rigide : classes.cisaillee).push(recomposition(monde));
  }
  const pireRigide = Math.max(0, ...classes.rigide),
    pireCisaillee = Math.max(0, ...classes.cisaillee);
  console.log(
    `  decomposition: ${classes.rigide.length} nodes without shear (relative delta ≤ ${pireRigide.toExponential(2)}), ` +
      `${classes.cisaillee.length} sheared (delta up to ${pireCisaillee.toExponential(2)}, inherent to T·R·S), ` +
      `${classes.nonFinie.length} singular or outside double (expected NaN, identical to the reference)`,
  );
  assert.ok(pireRigide <= 1e-9, `recomposition sans cisaillement ${pireRigide}`);
  assert.ok(
    classes.cisaillee.length > 0 && pireCisaillee > 1e-3,
    'le banc doit contenir de vrais cisaillements',
  );
});

test('hierarchies: negative scale carried by x only, determinant of the same sign as the source', () => {
  let renverses = 0;
  for (const { monde } of noeudsHierarchie) {
    const det = determinantMatrix4(monde);
    if (!(Number.isFinite(det) && Math.abs(det) > 1e-200)) continue;
    const s = new Float64Array(3);
    decomposeMatrix4(monde, new Float64Array(3), new Float64Array(4), s);
    assert.equal(Math.sign(s[0] * s[1] * s[2]), Math.sign(det));
    assert.ok(s[1] > 0 && s[2] > 0);
    if (det < 0) renverses++;
  }
  console.log(`  negative scale: ${renverses} flipped nodes, sign carried by x, y and z positive`);
  assert.ok(renverses > 0);
});

test('face winding: linear determinant and 4×4 determinant of the same sign outside a singular matrix', () => {
  let pire = 0,
    opposes = 0,
    compares = 0;
  for (const { monde } of noeudsHierarchie) {
    const a = linearPartDeterminant(monde),
      b = determinantMatrix4(monde);
    const echelle = normeColonne(monde, 0) * normeColonne(monde, 1) * normeColonne(monde, 2);
    if (!Number.isFinite(echelle) || echelle === 0 || !Number.isFinite(a) || !Number.isFinite(b))
      continue;
    compares++;
    const relatif = Math.abs(a - b) / echelle;
    pire = Math.max(pire, relatif);
    if (Math.sign(a) !== Math.sign(b) && Math.abs(b) / echelle > 1e-12) opposes++;
  }
  console.log(
    `  determinants: ${compares} nodes, maximum relative delta ${pire.toExponential(2)}, opposite signs ${opposes}`,
  );
  assert.ok(pire <= 64 * Number.EPSILON, `relative delta ${pire}`);
  assert.equal(opposes, 0);
});

test('sRGB: the repository curve and the reference rounded constants stay under the declared bound', () => {
  let versLineaire = 0,
    allerRetour = 0;
  for (let i = 0; i <= 4096; i++) {
    const c = i / 4096;
    versLineaire = Math.max(versLineaire, Math.abs(srgbToLinear(c) - SRGBToLinear(c)));
    allerRetour = Math.max(allerRetour, Math.abs(linearToSrgb(srgbToLinear(c)) - c));
  }
  console.log(
    `  sRGB → linear: maximum delta ${versLineaire.toExponential(2)}; round-trip ${allerRetour.toExponential(2)}`,
  );
  assert.ok(versLineaire < SRGB_REFERENCE_GAP);
  assert.ok(allerRetour < 1e-12);
});
