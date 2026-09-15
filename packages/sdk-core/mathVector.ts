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
  outOffset = 0,
) {
  const ax = a[0],
    ay = a[1],
    az = a[2];
  const bx = b[0],
    by = b[1],
    bz = b[2];
  out[outOffset] = ay * bz - az * by;
  out[outOffset + 1] = az * bx - ax * bz;
  out[outOffset + 2] = ax * by - ay * bx;
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
