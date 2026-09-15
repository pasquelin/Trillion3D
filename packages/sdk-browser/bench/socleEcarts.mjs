// Les écarts expliqués du banc du socle : là où le dépôt calcule autrement que la référence, ou là où
// l'opération elle-même ne peut pas rendre son entrée. Chaque écart est chiffré en console et borné
// par une assertion : il ne se lit jamais comme une égalité, et ne se cache jamais.
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
} from '../../sdk-core/index.ts';
import { noeudsHierarchie } from './socleEquivalence.mjs';

const normeColonne = (m, c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]);
/** Plus grand cosinus entre deux colonnes linéaires : zéro sans cisaillement. */
function cisaillement(m) {
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
/** Écart relatif maximal entre `m` et la recomposition de sa décomposition, partie linéaire seule. */
function recomposition(m) {
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

test('hiérarchies : la décomposition rend la matrice monde sans cisaillement, pas avec', () => {
  const classes = { rigide: [], cisaillee: [], nonFinie: [] };
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
    `  décomposition : ${classes.rigide.length} nœuds sans cisaillement (écart relatif ≤ ${pireRigide.toExponential(2)}), ` +
      `${classes.cisaillee.length} cisaillés (écart jusqu'à ${pireCisaillee.toExponential(2)}, inhérent à T·R·S), ` +
      `${classes.nonFinie.length} singuliers ou hors du double (NaN attendus, identiques à la référence)`,
  );
  assert.ok(pireRigide <= 1e-9, `recomposition sans cisaillement ${pireRigide}`);
  assert.ok(
    classes.cisaillee.length > 0 && pireCisaillee > 1e-3,
    'le banc doit contenir de vrais cisaillements',
  );
});

test('hiérarchies : échelle négative portée par x seul, déterminant de même signe que la source', () => {
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
  console.log(
    `  échelle négative : ${renverses} nœuds renversés, signe porté par x, y et z positifs`,
  );
  assert.ok(renverses > 0);
});

test('sens des faces : déterminant linéaire et déterminant 4×4 de même signe hors matrice singulière', () => {
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
    `  déterminants : ${compares} nœuds, écart relatif maximal ${pire.toExponential(2)}, signes opposés ${opposes}`,
  );
  assert.ok(pire <= 64 * Number.EPSILON, `écart relatif ${pire}`);
  assert.equal(opposes, 0);
});

test('sRGB : la courbe du dépôt et les constantes arrondies de la référence restent sous 1e-9', () => {
  let versLineaire = 0,
    allerRetour = 0;
  for (let i = 0; i <= 4096; i++) {
    const c = i / 4096;
    versLineaire = Math.max(versLineaire, Math.abs(srgbToLinear(c) - SRGBToLinear(c)));
    allerRetour = Math.max(allerRetour, Math.abs(linearToSrgb(srgbToLinear(c)) - c));
  }
  console.log(
    `  sRGB → linéaire : écart maximal ${versLineaire.toExponential(2)} ; aller-retour ${allerRetour.toExponential(2)}`,
  );
  assert.ok(versLineaire < 1e-9);
  assert.ok(allerRetour < 1e-12);
});
