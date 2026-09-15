import { LIGHT_SETTINGS, MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';

/** Côté d'une page de l'atlas, en texels : la maille d'invalidation d'une face. */
export const SHADOW_PAGE = LIGHT_SETTINGS.shadowPage;
/** Rangées de pages d'une face au plus grand côté publié : 1024 / 128 = 8, donc 64 pages. */
const MAX_PAGE_ROWS = Math.max(1, Math.floor(LIGHT_SETTINGS.shadowSliceMax / SHADOW_PAGE));
/**
 * Une rangée de pages tient dans un octet — huit pages au plus — donc le masque d'une face est
 * `MAX_PAGE_ROWS` octets, un par rangée. Deux rangées identiques se reconnaissent alors par une
 * égalité d'octets, ce qui est exactement ce que le groupement en régions contiguës demande.
 */
export const SHADOW_MASK_BYTES = MAX_SHADOW_SLICES * POINT_FACES * MAX_PAGE_ROWS;

/** Premier octet du masque d'une face dans le tableau commun. */
export const maskBase = (slice: number, face: number) =>
  (slice * POINT_FACES + face) * MAX_PAGE_ROWS;

/** Pages par côté d'une face de `side` texels, bornées par ce que le masque sait porter. */
export const pageRowsOf = (side: number) =>
  Math.max(1, Math.min(MAX_PAGE_ROWS, Math.round(side / SHADOW_PAGE)));

/** Toute la face est périmée : la lampe a bougé, la tranche a changé de taille, ou c'est la première. */
export function markWholeFace(mask: Uint8Array, base: number, rows: number) {
  const full = (1 << rows) - 1;
  for (let row = 0; row < MAX_PAGE_ROWS; row++) mask[base + row] = row < rows ? full : 0;
}

export function clearFace(mask: Uint8Array, base: number) {
  for (let row = 0; row < MAX_PAGE_ROWS; row++) mask[base + row] = 0;
}

/** Vrai dès qu'une page de la face attend son dessin. */
export function faceDirty(mask: Uint8Array, base: number) {
  for (let row = 0; row < MAX_PAGE_ROWS; row++) if (mask[base + row]) return true;
  return false;
}

/** Pages en attente dans la face : ce que le compteur « pages en attente » additionne. */
export function countPages(mask: Uint8Array, base: number) {
  let count = 0;
  for (let row = 0; row < MAX_PAGE_ROWS; row++) {
    let bits = mask[base + row];
    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
  }
  return count;
}

/** Marque ou efface le rectangle de pages `[x0, x1] × [y0, y1]`, bornes comprises. */
export function setRect(
  mask: Uint8Array,
  base: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  on: boolean,
) {
  const span = (((1 << (x1 - x0 + 1)) - 1) << x0) & 0xff;
  for (let row = y0; row <= y1; row++)
    mask[base + row] = on ? mask[base + row] | span : mask[base + row] & ~span;
}

const clip = new Float64Array(3);

/** `x`, `y` et `w` d'un point monde dans l'espace de découpe de la face, matrice colonne-major. */
function project(m: Float32Array, b: number, x: number, y: number, z: number) {
  clip[0] = m[b] * x + m[b + 4] * y + m[b + 8] * z + m[b + 12];
  clip[1] = m[b + 1] * x + m[b + 5] * y + m[b + 9] * z + m[b + 13];
  clip[2] = m[b + 3] * x + m[b + 7] * y + m[b + 11] * z + m[b + 15];
  return clip;
}

/** Rang de page d'une coordonnée déjà exprimée en pages, ramené dans la face. */
const pageOf = (value: number, rows: number) => Math.max(0, Math.min(rows - 1, Math.floor(value)));

/**
 * Marque les pages de la face que la boîte monde `min..max` peut atteindre.
 *
 * Seuls ces pixels-là peuvent changer quand l'objet de cette boîte bouge : la carte garde un minimum
 * de profondeur sur tous les occulteurs, et les autres occulteurs, eux, n'ont pas bougé. Redessiner
 * ces pages avec la scène entière redonne donc exactement la profondeur d'un redessin complet, au
 * bit près, et le reste de la face reste juste parce qu'il n'a pas changé.
 *
 * Le majorant est pris à huit sommets. Un sommet derrière le plan de projection rend l'empreinte non
 * rectangulaire : la face entière est alors marquée, jamais moins. Rend vrai si quelque chose a été
 * marqué.
 */
export function markBoxPages(
  mask: Uint8Array,
  base: number,
  rows: number,
  matrix: Float32Array,
  matrixBase: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const p = project(
      matrix,
      matrixBase,
      corner & 1 ? max[0] : min[0],
      corner & 2 ? max[1] : min[1],
      corner & 4 ? max[2] : min[2],
    );
    if (p[2] <= 1e-6) {
      markWholeFace(mask, base, rows);
      return true;
    }
    const nx = p[0] / p[2],
      ny = p[1] / p[2];
    if (nx < u0) u0 = nx;
    if (nx > u1) u1 = nx;
    if (ny < v0) v0 = ny;
    if (ny > v1) v1 = ny;
  }
  if (u1 < -1 || u0 > 1 || v1 < -1 || v0 > 1) return false;
  // `y` descend dans le cadre de dessin alors qu'il monte dans l'espace normalisé : la rangée basse
  // de la face est donc le bord supérieur de la boîte projetée.
  const x0 = pageOf((u0 * 0.5 + 0.5) * rows, rows),
    x1 = pageOf((u1 * 0.5 + 0.5) * rows, rows),
    y0 = pageOf((0.5 - v1 * 0.5) * rows, rows),
    y1 = pageOf((0.5 - v0 * 0.5) * rows, rows);
  setRect(mask, base, x0, x1, y0, y1, true);
  return true;
}
