/**
 * Plans d'un tronc de vue, rangés à plat : vingt-quatre flottants, quatre par plan `a, b, c, d`,
 * tournés vers l'intérieur — un point est dedans quand `a·x + b·y + c·z + d >= 0` pour les six.
 *
 * Ordre des plans, celui de Three.js : droite (`w − x`), gauche (`w + x`), bas (`w + y`), haut
 * (`w − y`), loin (`w − z`), proche. Le plan proche vaut `w + z` quand la profondeur de découpe va
 * de −1 à 1 (WebGL), `z` quand elle va de 0 à 1 (WebGPU). Les lignes combinées sont celles de la
 * matrice colonne-major `m` : `x = (m0, m4, m8, m12)`, `w = (m3, m7, m11, m15)`.
 */

/** Flottants des six plans d'un tronc. */
export const FRUSTUM_PLANE_VALUES = 24;

/**
 * Les quatre composantes brutes du plan en cours. Elles passent par ce tampon et non en arguments :
 * un flottant calculé passé à un appel que le compilateur n'intègre pas est encapsulé, soit une
 * allocation par composante et par image.
 */
const plane = new Float64Array(4);

/** Écrit le plan du tampon, normalisé au besoin : les quatre composantes multipliées par
 *  `1 / ‖(a, b, c)‖`. Tout est calculé en double avant l'écriture, pour qu'une sortie simple
 *  précision arrondisse une seule fois. */
function writePlane(out: Float32Array | Float64Array, at: number, normalize: boolean) {
  let a = plane[0],
    b = plane[1],
    c = plane[2],
    d = plane[3];
  if (normalize) {
    const inverse = 1.0 / Math.sqrt(a * a + b * b + c * c);
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

function writePlanes(
  out: Float32Array | Float64Array,
  m: ArrayLike<number>,
  depthZeroToOne: boolean,
  normalize: boolean,
) {
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
  plane[0] = m3 - m0;
  plane[1] = m7 - m4;
  plane[2] = m11 - m8;
  plane[3] = m15 - m12;
  writePlane(out, 0, normalize);
  plane[0] = m3 + m0;
  plane[1] = m7 + m4;
  plane[2] = m11 + m8;
  plane[3] = m15 + m12;
  writePlane(out, 4, normalize);
  plane[0] = m3 + m1;
  plane[1] = m7 + m5;
  plane[2] = m11 + m9;
  plane[3] = m15 + m13;
  writePlane(out, 8, normalize);
  plane[0] = m3 - m1;
  plane[1] = m7 - m5;
  plane[2] = m11 - m9;
  plane[3] = m15 - m13;
  writePlane(out, 12, normalize);
  plane[0] = m3 - m2;
  plane[1] = m7 - m6;
  plane[2] = m11 - m10;
  plane[3] = m15 - m14;
  writePlane(out, 16, normalize);
  plane[0] = depthZeroToOne ? m2 : m3 + m2;
  plane[1] = depthZeroToOne ? m6 : m7 + m6;
  plane[2] = depthZeroToOne ? m10 : m11 + m10;
  plane[3] = depthZeroToOne ? m14 : m15 + m14;
  writePlane(out, 20, normalize);
}

/**
 * Les six plans normalisés du tronc d'une matrice de découpe — une vue-projection, ou une
 * projection seule pour des plans en repère de vue. Normaux unitaires : `a·x + b·y + c·z + d` est
 * une distance signée. Une matrice dégénérée rend des plans NaN ou infinis, sans lever.
 */
export function frustumPlanesFromMatrix(
  out: Float32Array | Float64Array,
  m: ArrayLike<number>,
  depthZeroToOne: boolean,
) {
  writePlanes(out, m, depthZeroToOne, true);
}

/**
 * Les mêmes six plans sans normalisation, profondeur WebGL : les sommes et différences brutes des
 * lignes de `m`. Le signe de `a·x + b·y + c·z + d` décide seul, sans racine carrée ni division —
 * c'est la forme du test exact d'une coupe, où normaliser déplacerait l'arrondi.
 */
export function clipPlanesFromMatrix(out: Float64Array, m: ArrayLike<number>) {
  writePlanes(out, m, false, false);
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
