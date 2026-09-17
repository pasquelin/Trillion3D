// Les entrées du banc du socle mathématique : tirées à graine fixe et volontairement hostiles. Une
// formule qui ne tiendrait que sur des matrices bien élevées se verrait ici — échelles négatives et
// non uniformes, matrices singulières, NaN, zéros signés, infinis, dénormaux.
import * as THREE from 'three';
import { graine } from '../../sdk-core/bench/mesure.mjs';

const alea = graine(0x50c1e);
/** Les valeurs qu'un flottant peut prendre et qu'une formule doit traverser sans les lisser. */
export const BORDS = [0, -0, 1, -1, Infinity, -Infinity, NaN, 5e-324, 1e308, -1e308, 0.5, -0.5];
const bord = () => BORDS[Math.floor(alea() * BORDS.length)];
const nombre = () => (alea() < 0.15 ? bord() : (alea() * 2 - 1) * 10 ** Math.floor(alea() * 8 - 4));

/** Une pose rigide, puis une échelle tirée parmi : uniforme, non uniforme, négative, nulle. */
function pose(i) {
  const q = new THREE.Quaternion(alea() - 0.5, alea() - 0.5, alea() - 0.5, alea() - 0.5);
  q.normalize();
  const echelles = [
    [1, 1, 1],
    [2, 2, 2],
    [0.25, 3, 7],
    [-1, 1, 1],
    [-2, -0.5, 4],
    [0, 1, 1],
    [1e-300, 1, 1],
  ];
  const s = echelles[i % echelles.length];
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(alea() * 200 - 100, alea() * 200 - 100, alea() * 200 - 100),
    q,
    new THREE.Vector3(s[0], s[1], s[2]),
  );
  return Float64Array.from(m.elements);
}

/** Matrices : poses affines, puis entièrement tirées, puis parsemées de bords sur toute la matrice. */
export const matrices = [];
for (let i = 0; i < 400; i++) matrices.push(pose(i));
for (let i = 0; i < 300; i++) {
  const m = new Float64Array(16);
  for (let k = 0; k < 16; k++) m[k] = i % 3 === 0 ? nombre() : alea() * 4 - 2;
  matrices.push(m);
}
for (let i = 0; i < 12 * 16; i++) {
  const m = pose(i);
  m[i % 16] = BORDS[i % BORDS.length];
  matrices.push(m);
}
/** Matrices de bords pures : zéros signés, unités et non-finis mêlés sur toutes les entrées. */
for (let i = 0; i < 200; i++) matrices.push(Float64Array.from({ length: 16 }, bord));
matrices.push(new Float64Array(16), new Float64Array(16).fill(-0));

/**
 * Les mêmes, ARRONDIES en simple précision mais tenues en double : c'est ainsi qu'un tampon de rendu
 * entre dans le socle depuis ce lot. Le produit ne lit et n'écrit qu'un seul type de tampon
 * (`mathMatrix4.ts`), et la conversion en simple précision se fait à l'ENVOI, sur le résultat. Les
 * valeurs, elles, sont exactement celles d'un `Float32Array`, donc les mêmes bits qu'avant.
 */
const matrices32 = matrices.map((m) => Float64Array.from(Float32Array.from(m)));

/** Les affines seules : dernière ligne `(0, 0, 0, 1)` exacte, le domaine d'une pose de nœud. */
export const affines = matrices.filter(
  (m) => m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1,
);

/** Des points ordinaires, puis des points de bords. */
export const points = [];
for (let i = 0; i < 1500; i++)
  points.push([alea() * 400 - 200, alea() * 400 - 200, alea() * 400 - 200]);
for (let i = 0; i < 300; i++) points.push([nombre(), nombre(), nombre()]);
for (const a of BORDS) for (const b of BORDS) points.push([a, b, -0]);

/** Les paires de matrices que les produits reçoivent : chaque matrice contre une voisine. */
export const paires = matrices.map((a, i) => [a, matrices[(i * 7 + 3) % matrices.length]]);
export const paires32 = matrices32.map((a, i) => [a, matrices32[(i * 7 + 3) % matrices32.length]]);
