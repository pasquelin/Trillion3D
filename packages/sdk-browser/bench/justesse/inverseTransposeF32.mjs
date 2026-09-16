// Le noyau `inverseTranspose3` d'`inverseTransposeWgsl.ts`, rejoué en f32 côté JS : même ordre
// d'opérations, même arrondi à chaque produit et à chaque somme (`Math.fround`), mêmes gardes. C'est
// le MODÈLE — il dit ce que le nuanceur doit calculer, pas ce qu'il calcule. Ce qui le rattache au
// texte réellement exécuté est mesuré ailleurs : `test/normalTransformArithmetique.browser.mjs`
// compare, cas par cas, ce modèle à la sortie du shader livré dans Chromium WebGPU. Sans cette
// mesure, le modèle ne serait qu'une seconde implémentation, libre de dériver en silence.
//
// Écrit ici plutôt que dans un test : `normalTransform.test.ts` (éclairage),
// `gpuDagInverseTranspose.test.ts` (sélection) et la preuve navigateur lisent tous les trois la même
// arithmétique, au lieu d'en tenir chacun une copie.

export const f = Math.fround;
export const croix = (a, b) => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
];
export const point = (a, b) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
export const divise = (a, t) => [f(a[0] / t), f(a[1] / t), f(a[2] / t)];
export const norme = (a) => Math.hypot(a[0], a[1], a[2]);
export const unitaire = (a) => divise(a, norme(a));

/**
 * L'angle, en radians, entre deux directions non orientées — colinéaire vaut zéro. Par `atan2` du
 * produit vectoriel sur le produit scalaire, en f64 et sans normaliser : `acos` d'un produit
 * scalaire de vecteurs normalisés en f32 amplifie l'erreur d'arrondi de la norme (acos(1−ε) ≈ √(2ε),
 * soit 2e-4 rad pour un ε d'un ULP f32) et annoncerait un écart là où les deux vecteurs sont
 * identiques au bit près.
 */
export function angleEntre(a, b) {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(
    Math.hypot(c[0], c[1], c[2]),
    Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]),
  );
}

/** La 3×3 supérieure gauche d'une matrice monde 4×4 rangée par colonnes, en trois colonnes. */
export const colonnes3 = (world) => [
  [world[0], world[1], world[2]],
  [world[4], world[5], world[6]],
  [world[8], world[9], world[10]],
];

/** `mat3x3f(cross(b,c),cross(c,a),cross(a,b)) * v`, dans l'ordre du WGSL. */
export function cofacteur([a, b, c], v) {
  const [x, y, z] = [croix(b, c), croix(c, a), croix(a, b)];
  return [0, 1, 2].map((k) => f(f(f(x[k] * v[0]) + f(y[k] * v[1])) + f(z[k] * v[2])));
}

/** Le seuil absolu d'AVANT les défauts 6 et 9, en f32 : `abs(det)<1e-20` sur la 3×3 brute. */
export function avantLeLot(m, v) {
  const [a, b, c] = m;
  const det = point(a, croix(b, c));
  if (Math.abs(det) < 1e-20) return v;
  return divise(cofacteur(m, v), det);
}

/** Le noyau livré, en f32 : 3×3 divisée par la somme de ses valeurs absolues avant le déterminant. */
export function apresLeLot(m, v) {
  const t = m.reduce((s, col) => f(s + col.reduce((k, x) => f(k + Math.abs(x)), 0)), 0);
  if (!(t > 0) || !Number.isFinite(t)) return v;
  const n = m.map((col) => divise(col, t));
  const det = point(n[0], croix(n[1], n[2]));
  if (!(Math.abs(det) > 1e-20)) return v;
  return divise(cofacteur(n, v), f(det * t));
}

/**
 * `xformNormal(world, n)` du nuanceur d'éclairage : l'inverse-transposée de la 3×3 monde appliquée
 * à la normale locale, puis renormalisée. `world` est la 4×4 rangée par colonnes.
 */
export const xformNormalModele = (world, n) => unitaire(apresLeLot(colonnes3(world), n));

/** La même composition avec la forme d'avant le lot, pour dire ce que le défaut rendait. */
export const xformNormalAvantLeLot = (world, n) => unitaire(avantLeLot(colonnes3(world), n));
