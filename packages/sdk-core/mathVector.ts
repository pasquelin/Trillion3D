import type { NumberSink } from './mathMatrix4.ts';

/**
 * Vecteurs 3 et 4 du socle mathématique : produits et transformations par une matrice 4×4
 * colonne-major, sortie passée en paramètre. Les formules sont celles de la bibliothèque 3D de
 * référence, terme à terme et dans le même ordre, donc les mêmes bits.
 */

/** `a · b` sur les trois premières composantes. */
export function dotVector3(a: ArrayLike<number>, b: ArrayLike<number>) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * `out[outOffset..outOffset + 2] = a × b`. Les six composantes sont lues avant la première écriture,
 * donc `out` peut être `a` ou `b`.
 */
export function crossVector3<T extends NumberSink>(
  out: T,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
) {
  const ax = a[0],
    ay = a[1],
    az = a[2];
  const bx = b[0],
    by = b[1],
    bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

/**
 * `out[outOffset..outOffset + 2] = M · (x, y, z, 1)`, sans division perspective : la forme d'une
 * matrice affine, dont la dernière ligne vaut `(0, 0, 0, 1)`. Pour une telle matrice et un point
 * fini, c'est bit pour bit la transformation projective, dont le facteur `1 / w` vaut alors 1.
 */
export function transformAffinePoint<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  out[outOffset] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[outOffset + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[outOffset + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/**
 * `out[outOffset..outOffset + 3] = M · (x, y, z, 1)`, les quatre composantes homogènes et sans
 * division : le point en espace de découpe quand `M` est une vue-projection. L'appelant divise par
 * la quatrième, après avoir écarté celle qui est nulle ou non finie.
 */
export function transformHomogeneousPoint<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  outOffset = 0,
) {
  transformAffinePoint(out, m, x, y, z, outOffset);
  out[outOffset + 3] = m[3] * x + m[7] * y + m[11] * z + m[15];
  return out;
}

/** `v.normalize()` de la référence : chaque composante multipliée par `1 / (longueur || 1)`. */
export function normalizeVector3(v: NumberSink) {
  const inverse = 1 / (Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1);
  v[0] *= inverse;
  v[1] *= inverse;
  v[2] *= inverse;
}

/** `v.lengthSq()` : la somme des trois carrés, dans l'ordre de la référence. */
export function lengthSqVector3(v: ArrayLike<number>) {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

/** `v.multiplyScalar(s)` : les trois composantes de `out` multipliées sur place. */
export function scaleVector3<T extends NumberSink>(out: T, s: number) {
  out[0] *= s;
  out[1] *= s;
  out[2] *= s;
  return out;
}

/** `out.copy(a).multiplyScalar(s)` : la copie puis le facteur, donc `out = a · s` composante à composante. */
export function copyScaledVector3<T extends NumberSink>(out: T, a: ArrayLike<number>, s: number) {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

/** `v.addScaledVector(a, s)` : `out += a · s`, composante par composante. */
export function addScaledVector3<T extends NumberSink>(out: T, a: ArrayLike<number>, s: number) {
  out[0] += a[0] * s;
  out[1] += a[1] * s;
  out[2] += a[2] * s;
  return out;
}

/**
 * `v.applyMatrix3(m)` : `out = M · (x, y, z)`, `m` colonne-major sur neuf nombres. Les trois
 * composantes sont lues en paramètre, donc `out` peut être le vecteur d'entrée lui-même.
 */
export function applyMatrix3Vector3<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
) {
  out[0] = m[0] * x + m[3] * y + m[6] * z;
  out[1] = m[1] * x + m[4] * y + m[7] * z;
  out[2] = m[2] * x + m[5] * y + m[8] * z;
  return out;
}

/**
 * `v.transformDirection(m)` : le bloc 3×3 d'une matrice 4×4 affine appliqué à une direction, puis la
 * normalisation de la référence. La translation est ignorée, comme pour tout vecteur de direction.
 */
export function transformDirectionVector3<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
) {
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
  normalizeVector3(out);
  return out;
}
