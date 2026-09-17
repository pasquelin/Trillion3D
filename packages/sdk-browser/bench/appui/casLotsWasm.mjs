// Les cas du banc M5 : ce qu'on donne à manger aux deux chemins pour qu'ils aient une chance de ne
// pas rendre les mêmes bits. Tout ce qui sépare une arithmétique flottante d'une autre est là —
// échelles négatives, cisaillement, division homogène par un `w` nul, NaN, zéros signés, infinis,
// extrêmes de l'exposant — et le reste du lot est du pseudo-aléatoire à graine fixe, pour que deux
// exécutions voient exactement les mêmes entrées.
import { graine } from '../../../sdk-core/bench/socle.mjs';

/** Les tailles de lot mesurées : de ce qu'une image bouge à ce qu'une scène entière porte. */
export const TAILLES = [1_000, 10_000, 100_000];

const identite = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const avec = (changements) => {
  const m = identite();
  for (const [i, v] of changements) m[i] = v;
  return m;
};

/** Matrices hostiles, colonne-major. */
const MATRICES = [
  identite(),
  avec([
    [0, -1],
    [5, -2.5],
    [10, -0.125],
  ]),
  avec([
    [4, 0.75],
    [8, -1.5],
    [9, 2.25],
  ]),
  avec([
    [3, 0.5],
    [7, -0.25],
    [11, 1.5],
    [15, 2],
  ]),
  avec([
    [3, 1],
    [15, 0],
  ]),
  avec([
    [0, 0],
    [5, -0],
    [10, -0],
  ]),
  avec([[12, NaN]]),
  avec([
    [13, Infinity],
    [14, -Infinity],
  ]),
  avec([
    [0, 1e308],
    [5, 1e-308],
    [10, 5e-324],
  ]),
];

/** Boîtes hostiles : vide canonique, vide inversée, plate, NaN, zéros signés, infinies. */
const BOITES = [
  [-1, -1, -1, 1, 1, 1],
  [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
  [0, -0, 0, -0, 0, -0],
  [NaN, 0, 0, 1, NaN, 1],
  [-Infinity, -1, -1, Infinity, 1, 1],
  [2, 2, 2, 1, 1, 1],
  [0, 0, 0, 0, 0, 0],
];

/** Les premiers éléments du lot croisent tous les cas hostiles ; au-delà, du tirage à graine fixe. */
const HOSTILES = MATRICES.length * BOITES.length;

/** Une matrice ordinaire : rotation quelconque écrite à la main, translation et échelle non uniforme. */
function matriceOrdinaire(alea) {
  const c = Math.cos(alea() * 6.283185307179586),
    s = Math.sin(alea() * 6.283185307179586);
  const sx = 0.5 + alea() * 2,
    sy = 0.5 + alea() * 2,
    sz = 0.5 + alea() * 2;
  return [
    c * sx,
    s * sx,
    0,
    0,
    -s * sy,
    c * sy,
    0,
    0,
    0,
    0,
    sz,
    0,
    alea() * 200 - 100,
    alea() * 200 - 100,
    alea() * 200 - 100,
    1,
  ];
}

/** Remplit `boxes` (6 · n) et `mats` (16 · n) du lot de transformation de boîtes. */
export function remplitBoites(lot, n) {
  const alea = graine(0x4d35);
  for (let i = 0; i < n; i++) {
    const m = i < HOSTILES ? MATRICES[i % MATRICES.length] : matriceOrdinaire(alea);
    const b =
      i < HOSTILES
        ? BOITES[Math.floor(i / MATRICES.length) % BOITES.length]
        : [alea() * -50, alea() * -50, alea() * -50, alea() * 50, alea() * 50, alea() * 50];
    for (let k = 0; k < 16; k++) lot.mats[i * 16 + k] = m[k];
    for (let k = 0; k < 6; k++) lot.boxes[i * 6 + k] = b[k];
  }
}

/** Remplit `a` et `b` (16 · n chacun) du lot de produits 4×4. */
export function remplitMatrices(lot, n) {
  const alea = graine(0x7f21);
  for (let i = 0; i < n; i++) {
    const g = i < HOSTILES ? MATRICES[i % MATRICES.length] : matriceOrdinaire(alea);
    const d =
      i < HOSTILES
        ? MATRICES[Math.floor(i / MATRICES.length) % MATRICES.length]
        : matriceOrdinaire(alea);
    for (let k = 0; k < 16; k++) {
      lot.a[i * 16 + k] = g[k];
      lot.b[i * 16 + k] = d[k];
    }
  }
}
