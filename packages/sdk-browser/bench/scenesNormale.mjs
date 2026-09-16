// Les repères hostiles du banc du lot 4 : poses, attributs de sommet et poids barycentriques choisis
// pour tomber sur tous les cas limites du repère tangent — vecteur nul que la normalisation laisse
// nul, matrice singulière dont la matrice des normales est nulle, échelle négative qui retourne la
// face, cisaillement, échelle non uniforme, NaN, ±0 et infinis.
//
// Deux couples sont là pour que l'ordre des termes se voie. Une pose porte une ligne qui s'annule
// (`1e16`, `−1e16`, `3`) que des sommets tout à un traversent : la somme vaut 3 dans l'ordre de la
// référence et 4 dans l'autre. Une seconde pose a pour matrice des normales exactement
// `[[1, 1, 1], [0, 1, 0], [0, 0, 1]]`, et les normales de sommet qui l'accompagnent valent
// `(1e16, 1, 1)` : là encore la somme dépend de l'ordre. Sans ces deux-là, toutes les poses sont
// assez creuses pour qu'une addition réassociée passe inaperçue.
//
// Les attributs sont en simple précision, comme une géométrie importée : les deux côtés lisent donc
// les mêmes valeurs arrondies, et l'écart éventuel ne peut venir que de l'algèbre.
import * as THREE from 'three';

/** Poses hostiles, en colonne-major : cisaillement, singulière et ligne qui s'annule comprises. */
const POSES = [
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [-1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0.25, 0, 5, -2, 7, 1],
  [0.5, 0.25, 0, 0, -0.75, 2, 0.5, 0, 0.125, -0.25, 1.5, 0, 1, 2, 3, 1],
  [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  [1, 2, 3, 0, 2, 4, 6, 0, 3, 6, 9, 0, 0, 0, 0, 1],
  [1e-30, 0, 0, 0, 0, 1e-30, 0, 0, 0, 0, 1e-30, 0, 0, 0, 0, 1],
  [NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
  [1e16, 1, 1, 0, -1e16, 1, 1, 0, 3, 1, 1, 0, 0, 0, 0, 1],
  [1, -1, -1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
];

/** Triplets de normales de sommet : unitaires, nuls, signés, non finis, tout à un, très étalés. */
const NORMALES = [
  [0, 1, 0, 0, 1, 0, 0, 1, 0],
  [0, 0, 0, 1, 0, 0, 0, 0, 1],
  [-0, -0, -0, 0.6, 0, 0.8, -1, -0, 0],
  [NaN, 1, 0, Infinity, 0, 0, 1, -Infinity, 0],
  [1e-38, 1e-38, 1e-38, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5],
  [1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1e16, 1, 1, 1e16, 1, 1, 1e16, 1, 1],
];

/** Triplets de tangentes `(x, y, z, w)` : `w` porte le signe de la bitangente. */
const TANGENTES = [
  [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  [0, 0, 0, -1, 1, 0, 0, -1, 0, 1, 0, 1],
  [-0, 0, -0, 0, NaN, 0, 0, 1, Infinity, 0, 0, -1],
  [1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, 1],
];

/** Coordonnées de texture : plates (dégénérées), ordinaires, et non finies. */
const UVS = [
  [0, 0, 1, 0, 0, 1],
  [0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
  [-0, 0, NaN, 1, 2, Infinity],
];

/** Sommets monde : un triangle ordinaire, un triangle plat, un triangle non fini. */
const TRIANGLES = [
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
  [2, 3, 4, 2, 3, 4, 2, 3, 4],
  [-0, 0, 0, 1e30, 0, 0, 0, NaN, 0],
];

/** Poids barycentriques hostiles : zéro signé, NaN, infinis, dénormal. */
const POIDS = [
  [0.25, 0.25, 0.5],
  [1, 0, -0],
  [0, -0, NaN],
  [Infinity, -Infinity, 1],
  [5e-324, 1, -1],
];

/** Les garnitures retenues : `[normales, tangentes, coordonnées]`, la dernière tout à un. */
const GARNITURES = [
  [0, 0, 0],
  [1, 1, 1],
  [2, 2, 2],
  [3, 2, 1],
  [4, 0, 2],
  [5, 3, 0],
  [6, 3, 0],
];

const attribut = (valeurs, taille) => new THREE.BufferAttribute(Float32Array.from(valeurs), taille);

/** Les quatre jeux d'attributs d'une garniture : avec tangentes, sans, sans normales, sans UV. */
function attributs([n, t, u]) {
  const normal = () => attribut(NORMALES[n], 3),
    tangent = () => attribut(TANGENTES[t], 4),
    uv = () => attribut(UVS[u], 2);
  return [
    { normal: normal(), tangent: tangent(), uv: uv() },
    { normal: normal(), uv: uv() },
    { uv: uv() },
    { normal: normal(), tangent: tangent() },
  ];
}

/** Un sommet projeté tel que le rasteriseur le rend : seule la position monde est lue ici. */
const sommet = (v, at) => ({ worldX: v[at], worldY: v[at + 1], worldZ: v[at + 2] });

/**
 * Le produit complet : chaque pose, chaque garniture, chaque triangle, chaque jeu de poids. Les
 * indices de sommet tournent pour que les trois coins ne lisent pas toujours la même ligne.
 */
export function reperes() {
  const lot = [];
  for (const pose of POSES) {
    const matrix = new THREE.Matrix4().fromArray(pose);
    for (const garniture of GARNITURES)
      for (const attributes of attributs(garniture))
        for (let v = 0; v < TRIANGLES.length; v++) {
          const coins = TRIANGLES[v];
          const tri = {
            a: sommet(coins, 0),
            b: sommet(coins, 3),
            c: sommet(coins, 6),
            i0: 0,
            i1: (v + 1) % 3,
            i2: (v + 2) % 3,
          };
          for (const w of POIDS)
            lot.push({
              page: { array: new Uint32Array([0, 1, 2]), attributes, matrix },
              tri,
              bary: { w0: w[0], w1: w[1], w2: w[2] },
            });
        }
  }
  return lot;
}
