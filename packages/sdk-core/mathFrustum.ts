/**
 * Plans d'un tronc de vue, rangés à plat : vingt-quatre flottants, quatre par plan `a, b, c, d`,
 * tournés vers l'intérieur — un point est dedans quand `a·x + b·y + c·z + d >= 0` pour les six.
 *
 * Ordre des plans, celui de la référence : droite (`w − x`), gauche (`w + x`), bas (`w + y`), haut
 * (`w − y`), loin, proche. La profondeur du moteur est INVERSÉE dans `[0, 1]` — plan proche à 1,
 * lointain à 0 (`mathCamera.ts`) — donc le plan LOIN est `z >= 0` et le plan PROCHE `w − z >= 0`,
 * l'inverse exact des rôles qu'ils ont en profondeur directe. Les lignes combinées sont celles de
 * la matrice colonne-major `m` : `x = (m0, m4, m8, m12)`, `w = (m3, m7, m11, m15)`.
 *
 * Plan lointain infini : la ligne `z` de la projection est `(0, 0, 0, near)`, donc le plan LOIN
 * sort de normale nulle. Un tel plan ne borne rien, et c'est exactement ce que le lointain infini
 * veut dire : `writePlane` l'écrit tout à zéro, et `0 >= 0` laisse tout point dedans.
 */

/** Flottants des six plans d'un tronc. */
export const FRUSTUM_PLANE_VALUES = 24;

/** Écrit un plan, normalisé au besoin : les quatre composantes multipliées par `1 / ‖(a, b, c)‖`.
 *  Tout est calculé en double avant l'écriture, pour qu'une sortie simple précision arrondisse
 *  une seule fois. Les composantes passent en arguments et non par un tampon de module : mesuré
 *  deux fois plus rapide, le compilateur intègre l'appel et aucune n'est encapsulée. */
function writePlane(
  out: Float32Array | Float64Array,
  at: number,
  a: number,
  b: number,
  c: number,
  d: number,
  normalize: boolean,
) {
  if (normalize) {
    // Normale nulle : le plan ne borne rien. Normaliser rendrait des NaN, qui rejetteraient tout.
    const length = Math.sqrt(a * a + b * b + c * c);
    const inverse = length > 0 ? 1.0 / length : 0;
    a *= inverse;
    b *= inverse;
    c *= inverse;
    d *= inverse;
  }
  out[at] = a;
  out[at + 1] = b;
  out[at + 2] = c;
  out[at + 3] = d;
}

function writePlanes(out: Float32Array | Float64Array, m: ArrayLike<number>, normalize: boolean) {
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3];
  const m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7];
  const m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11];
  const m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15];
  writePlane(out, 0, m3 - m0, m7 - m4, m11 - m8, m15 - m12, normalize);
  writePlane(out, 4, m3 + m0, m7 + m4, m11 + m8, m15 + m12, normalize);
  writePlane(out, 8, m3 + m1, m7 + m5, m11 + m9, m15 + m13, normalize);
  writePlane(out, 12, m3 - m1, m7 - m5, m11 - m9, m15 - m13, normalize);
  writePlane(out, 16, m2, m6, m10, m14, normalize);
  writePlane(out, 20, m3 - m2, m7 - m6, m11 - m10, m15 - m14, normalize);
}

/**
 * Les six plans normalisés du tronc d'une matrice de découpe — une vue-projection, ou une
 * projection seule pour des plans en repère de vue. Normaux unitaires : `a·x + b·y + c·z + d` est
 * une distance signée. Une matrice dégénérée rend des plans NaN ou infinis, sans lever.
 */
export function frustumPlanesFromMatrix(out: Float32Array | Float64Array, m: ArrayLike<number>) {
  writePlanes(out, m, true);
}

/**
 * Les mêmes six plans sans normalisation : les sommes et différences brutes des lignes de `m`. Le
 * signe de `a·x + b·y + c·z + d` décide seul, sans racine carrée ni division — c'est la forme du
 * test exact d'une coupe, où normaliser déplacerait l'arrondi.
 */
export function clipPlanesFromMatrix(out: Float64Array, m: ArrayLike<number>) {
  writePlanes(out, m, false);
}

/**
 * Ramène des plans dans le repère local d'une transformation `m` (4×4 colonne-major) : chaque plan
 * `p` devient `p · m`, si bien qu'un point local `q` donne `p · (m q)`. Une boîte locale se teste
 * alors sans être transformée.
 */
export function frustumPlanesToLocal(
  out: Float64Array,
  planes: ArrayLike<number>,
  m: ArrayLike<number>,
) {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4],
      b = planes[i * 4 + 1],
      c = planes[i * 4 + 2],
      d = planes[i * 4 + 3];
    out[i * 4] = m[0] * a + m[1] * b + m[2] * c + m[3] * d;
    out[i * 4 + 1] = m[4] * a + m[5] * b + m[6] * c + m[7] * d;
    out[i * 4 + 2] = m[8] * a + m[9] * b + m[10] * c + m[11] * d;
    out[i * 4 + 3] = m[12] * a + m[13] * b + m[14] * c + m[15] * d;
  }
}
