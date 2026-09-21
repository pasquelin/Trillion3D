import { LIGHT_SETTINGS, MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';

/** Side of an atlas page, in texels: the invalidation cell of a face. */
export const SHADOW_PAGE = LIGHT_SETTINGS.shadowPage;
/** Page rows of a face at the largest published side: 1024 / 128 = 8, hence 64 pages. */
const MAX_PAGE_ROWS = Math.max(1, Math.floor(LIGHT_SETTINGS.shadowSliceMax / SHADOW_PAGE));
/**
 * A page row fits in a byte — eight pages at most — so a face mask is
 * `MAX_PAGE_ROWS` bytes, one per row. Two identical rows are then recognised by a
 * byte equality, which is exactly what grouping into contiguous regions asks.
 */
export const SHADOW_MASK_BYTES = MAX_SHADOW_SLICES * POINT_FACES * MAX_PAGE_ROWS;

/** First byte of a face mask in the shared array. */
export const maskBase = (slice: number, face: number) =>
  (slice * POINT_FACES + face) * MAX_PAGE_ROWS;

/** Pages per side of a `side`-texel face, bounded by what the mask can carry. */
export const pageRowsOf = (side: number) =>
  Math.max(1, Math.min(MAX_PAGE_ROWS, Math.round(side / SHADOW_PAGE)));

/** The whole face is stale: the light has moved, the slice has changed size, or this is the first. */
export function markWholeFace(mask: Uint8Array, base: number, rows: number) {
  mask.fill((1 << rows) - 1, base, base + rows);
  mask.fill(0, base + rows, base + MAX_PAGE_ROWS);
}

export function clearFace(mask: Uint8Array, base: number) {
  mask.fill(0, base, base + MAX_PAGE_ROWS);
}

/** True as soon as a page of the face awaits its draw. */
export function faceDirty(mask: Uint8Array, base: number) {
  for (let row = 0; row < MAX_PAGE_ROWS; row++) if (mask[base + row]) return true;
  return false;
}

/** Waiting pages in the face: what the "pending pages" counter adds. */
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

/** Marks or clears the page rectangle `[x0, x1] × [y0, y1]`, bounds included. */
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

/**
 * Marks the extent rectangle `[x0, x1] × [y0, y1]` of a face whose extent origin sits at
 * physical page `(wx, wy)`: a cascade map is addressed by absolute page, modulo the face, so
 * extent page `(x, y)` lives at physical page `((x + wx) mod rows, (y + wy) mod rows)`. The row
 * pattern is rotated once, then written on each wrapped row.
 */
export function markExtentRect(
  mask: Uint8Array,
  base: number,
  rows: number,
  wx: number,
  wy: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  const span = ((1 << (x1 - x0 + 1)) - 1) << x0;
  const bits = ((span << wx) | (span >> (rows - wx))) & ((1 << rows) - 1);
  for (let row = y0; row <= y1; row++) mask[base + ((row + wy) % rows)] |= bits;
}

/**
 * Marks the strips that enter when the extent slides by `(dx, dy)` pages: the last `dx`
 * columns for a slide to the right, the first `−dx` for one to the left, and likewise the
 * rows. Nothing is allocated: the bounds are four scalars.
 */
export function markExtentStrips(
  mask: Uint8Array,
  base: number,
  rows: number,
  wx: number,
  wy: number,
  dx: number,
  dy: number,
) {
  if (dx)
    markExtentRect(
      mask,
      base,
      rows,
      wx,
      wy,
      dx > 0 ? rows - dx : 0,
      dx > 0 ? rows - 1 : -dx - 1,
      0,
      rows - 1,
    );
  if (dy)
    markExtentRect(
      mask,
      base,
      rows,
      wx,
      wy,
      0,
      rows - 1,
      dy > 0 ? rows - dy : 0,
      dy > 0 ? rows - 1 : -dy - 1,
    );
}

const clip = new Float64Array(3);

/** `x`, `y` and `w` of a world point in the face clip space, column-major matrix. */
function project(m: Float32Array, b: number, x: number, y: number, z: number) {
  clip[0] = m[b] * x + m[b + 4] * y + m[b + 8] * z + m[b + 12];
  clip[1] = m[b + 1] * x + m[b + 5] * y + m[b + 9] * z + m[b + 13];
  clip[2] = m[b + 3] * x + m[b + 7] * y + m[b + 11] * z + m[b + 15];
  return clip;
}

/** Page rank of a coordinate already expressed in pages, brought back into the face. */
const pageOf = (value: number, rows: number) => Math.max(0, Math.min(rows - 1, Math.floor(value)));

/**
 * Marks the pages of the face that the world box `min..max` can reach, `matrix` being the
 * extent's and `(wx, wy)` the physical page of its origin.
 *
 * Only those pixels can change when the object of this box moves: the map keeps a minimum
 * of depth on every occluder, and the other occluders, for their part, have not moved. Redrawing
 * these pages with the whole scene therefore yields exactly the depth of a full redraw,
 * bit-exact, and the rest of the face stays correct because it has not changed.
 *
 * The bound is taken at eight vertices. A vertex behind the projection plane makes the footprint
 * non-rectangular: the whole face is then marked, never less. Returns true if something was
 * marked.
 */
export function markBoxPages(
  mask: Uint8Array,
  base: number,
  rows: number,
  matrix: Float32Array,
  matrixBase: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
  wx = 0,
  wy = 0,
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
  // `y` goes down in the draw frame while it goes up in normalised space: the low row
  // of the face is therefore the upper edge of the projected box.
  const x0 = pageOf((u0 * 0.5 + 0.5) * rows, rows),
    x1 = pageOf((u1 * 0.5 + 0.5) * rows, rows),
    y0 = pageOf((0.5 - v1 * 0.5) * rows, rows),
    y1 = pageOf((0.5 - v0 * 0.5) * rows, rows);
  markExtentRect(mask, base, rows, wx, wy, x0, x1, y0, y1);
  return true;
}
