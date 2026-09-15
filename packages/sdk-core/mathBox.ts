/**
 * Boîtes alignées sur les axes, rangées à plat : six flottants `minX, minY, minZ, maxX, maxY, maxZ`
 * à partir d'un décalage. Fonctions libres, sortie passée en paramètre, aucune allocation.
 *
 * Chaque opération garde l'arithmétique de la boîte de Three.js terme à terme — `Math.min` et
 * `Math.max` composante par composante, transformation homogène des huit coins avec division par
 * `w` — pour rendre les mêmes bits, NaN, zéros signés et infinis compris.
 */

/** Flottants d'une boîte rangée à plat. */
export const BOX_VALUES = 6;

/** Pose la boîte vide : bornes basses à `+Infinity`, hautes à `-Infinity`. */
export function boxEmpty(out: Float64Array, o: number) {
  out[o] = Infinity;
  out[o + 1] = Infinity;
  out[o + 2] = Infinity;
  out[o + 3] = -Infinity;
  out[o + 4] = -Infinity;
  out[o + 5] = -Infinity;
}

/** Vraie quand une borne haute passe sous sa borne basse. Une borne NaN ne rend pas la boîte vide. */
export function boxIsEmpty(box: ArrayLike<number>, o: number) {
  return box[o + 3] < box[o] || box[o + 4] < box[o + 1] || box[o + 5] < box[o + 2];
}

/** Étend la boîte à un point. */
export function boxExpandByPoint(out: Float64Array, o: number, x: number, y: number, z: number) {
  out[o] = Math.min(out[o], x);
  out[o + 1] = Math.min(out[o + 1], y);
  out[o + 2] = Math.min(out[o + 2], z);
  out[o + 3] = Math.max(out[o + 3], x);
  out[o + 4] = Math.max(out[o + 4], y);
  out[o + 5] = Math.max(out[o + 5], z);
}

/** Union de la boîte avec une autre donnée par ses six bornes. */
export function boxUnion(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  out[o] = Math.min(out[o], minX);
  out[o + 1] = Math.min(out[o + 1], minY);
  out[o + 2] = Math.min(out[o + 2], minZ);
  out[o + 3] = Math.max(out[o + 3], maxX);
  out[o + 4] = Math.max(out[o + 4], maxY);
  out[o + 5] = Math.max(out[o + 5], maxZ);
}

/**
 * Les huit coins d'une boîte transformés par `m` (4×4 colonne-major), écrits à plat — vingt-quatre
 * flottants à partir de `o`. Le coin `i` prend `max` sur l'axe x quand son bit 1 est levé, sur y
 * pour le bit 2, sur z pour le bit 4. Chaque coin est la transformation homogène d'un point :
 * `(m·p) / (m₃·p)`, l'inverse de `w` calculé une fois puis multiplié.
 */
export function boxCornersInto(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  m: ArrayLike<number>,
) {
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? maxX : minX,
      ly = i & 2 ? maxY : minY,
      lz = i & 4 ? maxZ : minZ;
    const mw = 1 / (m[3] * lx + m[7] * ly + m[11] * lz + m[15]);
    const at = o + i * 3;
    out[at] = (m[0] * lx + m[4] * ly + m[8] * lz + m[12]) * mw;
    out[at + 1] = (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * mw;
    out[at + 2] = (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * mw;
  }
}

const corners = new Float64Array(24);

/**
 * Boîte englobant l'image par `m` de la boîte `box` : l'union de ses huit coins transformés. Une
 * boîte vide reste telle quelle, bornes comprises. `out` peut être `box` : les bornes sont lues
 * avant la première écriture.
 */
export function boxTransform(
  out: Float64Array,
  o: number,
  box: ArrayLike<number>,
  bo: number,
  m: ArrayLike<number>,
) {
  const minX = box[bo],
    minY = box[bo + 1],
    minZ = box[bo + 2],
    maxX = box[bo + 3],
    maxY = box[bo + 4],
    maxZ = box[bo + 5];
  if (maxX < minX || maxY < minY || maxZ < minZ) {
    out[o] = minX;
    out[o + 1] = minY;
    out[o + 2] = minZ;
    out[o + 3] = maxX;
    out[o + 4] = maxY;
    out[o + 5] = maxZ;
    return;
  }
  boxCornersInto(corners, 0, minX, minY, minZ, maxX, maxY, maxZ, m);
  boxEmpty(out, o);
  for (let at = 0; at < 24; at += 3)
    boxExpandByPoint(out, o, corners[at], corners[at + 1], corners[at + 2]);
}
