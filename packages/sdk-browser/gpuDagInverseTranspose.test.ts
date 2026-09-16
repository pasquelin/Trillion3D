// Défaut 6 (seuil de `inverseTranspose3`, gpuDagShader.ts) : la dégénérescence d'une 3×3 se juge
// sur son déterminant NORMALISÉ, jamais sur le déterminant brut. Un seuil absolu juge l'échelle :
// une rotation d'échelle uniforme s a pour déterminant ±s³, donc s ≲ 2,15e-7 passait sous 1e-20 et
// le noyau rendait l'axe local non tourné — le rejet par cône supprimait alors des faces de face.
// Le comportement GPU réel est prouvé par `test/inverseTransposeePetiteEchelle.browser.mjs` ; ce
// test-ci rejoue la même arithmétique en f32 pour que `npm test` attrape la régression sans GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';

type Vec = [number, number, number];
const f = Math.fround;
const croix = (a: Vec, b: Vec): Vec => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];
const point = (a: Vec, b: Vec) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
const divise = (a: Vec, t: number): Vec => [f(a[0] / t), f(a[1] / t), f(a[2] / t)];
const norme = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const unitaire = (a: Vec): Vec => divise(a, norme(a));

/** Le seuil absolu d'avant le lot, en f32 : `abs(det)<1e-20` sur la 3×3 brute. */
function avantLeLot(m: [Vec, Vec, Vec], v: Vec): Vec {
  const [a, b, c] = m;
  const det = point(a, croix(b, c));
  if (Math.abs(det) < 1e-20) return v;
  return divise(cofacteur(m, v), det);
}

/** Le noyau livré, en f32 : 3×3 divisée par la somme de ses valeurs absolues avant le déterminant. */
function apresLeLot(m: [Vec, Vec, Vec], v: Vec): Vec {
  const t = m.reduce((s, col) => f(s + col.reduce((k, x) => f(k + Math.abs(x)), 0)), 0);
  if (!(t > 0) || !Number.isFinite(t)) return v;
  const n = m.map((col) => divise(col, t)) as [Vec, Vec, Vec];
  const det = point(n[0], croix(n[1], n[2]));
  if (!(Math.abs(det) > 1e-20)) return v;
  return divise(cofacteur(n, v), f(det * t));
}

function cofacteur([a, b, c]: [Vec, Vec, Vec], v: Vec): Vec {
  const [x, y, z] = [croix(b, c), croix(c, a), croix(a, b)];
  return [
    f(f(f(x[0] * v[0]) + f(y[0] * v[1])) + f(z[0] * v[2])),
    f(f(f(x[1] * v[0]) + f(y[1] * v[1])) + f(z[1] * v[2])),
    f(f(f(x[2] * v[0]) + f(y[2] * v[1])) + f(z[2] * v[2])),
  ];
}

/** Rotation de 180° autour de X, échelle uniforme s : l'axe local (0,0,1) doit devenir (0,0,-1). */
const tourneeDe180 = (s: number): [Vec, Vec, Vec] => [
  [f(s), 0, 0],
  [0, f(-s), 0],
  [0, 0, f(-s)],
];
const AXE: Vec = [0, 0, 1];

test('le seuil absolu rendait l’axe local dès que s³ passait sous 1e-20', () => {
  assert.deepEqual(unitaire(avantLeLot(tourneeDe180(1e-3), AXE)), [0, 0, -1]);
  assert.deepEqual(unitaire(avantLeLot(tourneeDe180(1e-8), AXE)), [0, 0, 1]);
});

test('le noyau livré tourne l’axe à toute échelle, de 1e6 à 1e-18', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-6, 2e-7, 1e-7, 1e-8, 1e-12, 1e-16, 1e-18])
    assert.deepEqual(unitaire(apresLeLot(tourneeDe180(s), AXE)), [0, 0, -1], `échelle ${s}`);
});

// La normalisation change l'arrondi f32 de quelques ULP : la direction rendue hors de la bande du
// seuil n'est donc pas bit à bit celle d'avant, elle lui est colinéaire à 1e-6 radian près. Ce qui
// compte est la décision de rejet, mesurée nulle part changée hors bande sur GPU réel — voir
// `bench/justesse/inverse-transposee-petite-echelle.mjs`.
test('hors de la bande du seuil, la direction rendue est celle d’avant à 1e-6 radian près', () => {
  for (const s of [1e6, 1e3, 1, 1e-3, 1e-4, 1e-5, 1e-6])
    for (const axe of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.6, -0.8, 0],
    ] as Vec[]) {
      const m = tourneeDe180(s);
      const ecart = Math.acos(
        Math.min(1, Math.abs(point(unitaire(apresLeLot(m, axe)), unitaire(avantLeLot(m, axe))))),
      );
      assert.ok(ecart < 1e-6, `échelle ${s} axe ${axe} : écart ${ecart} rad`);
    }
});

test('une 3×3 nulle, infinie ou NaN, ou une colonne nulle, rend le vecteur tel quel', () => {
  const nulle: [Vec, Vec, Vec] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  assert.deepEqual(apresLeLot(nulle, AXE), AXE);
  const colonneNulle = tourneeDe180(1e-8);
  colonneNulle[1] = [0, 0, 0];
  assert.deepEqual(apresLeLot(colonneNulle, AXE), AXE);
  for (const valeur of [Infinity, -Infinity, NaN]) {
    const abimee = tourneeDe180(1);
    abimee[0][0] = valeur;
    assert.deepEqual(apresLeLot(abimee, AXE), AXE);
  }
});

test('le shader livré ne porte plus de seuil absolu sur le déterminant brut', () => {
  const corps = DAG_SELECTION_SHADER.split('fn inverseTranspose3')[1].split('\n}')[0];
  assert.doesNotMatch(corps, /abs\(det\)<1e-20/, 'seuil absolu sur le determinant brut');
  assert.match(corps, /let a=m\[0\]\/t;let b=m\[1\]\/t;let c=m\[2\]\/t;/, 'normalisation absente');
  assert.match(corps, /if\(!\(abs\(det\)>1e-20\)\)\{return v;\}/, 'garde relative absente');
});
