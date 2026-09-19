/**
 * Axis-aligned bounding boxes, stored flat: six floats `minX, minY, minZ, maxX, maxY, maxZ`
 * starting at an offset. Free functions, output passed as parameter, zero allocation.
 *
 * Each operation preserves the arithmetic of Three.js Box3 term by term — `Math.min` and
 * `Math.max` component-wise, homogeneous transformation of the eight corners with division by
 * `w` — to yield the exact same bits, including NaN, signed zeroes, and infinities.
 */

/** Floats of a box stored flat. */
export const BOX_VALUES = 6;

/** Sets an empty box: lower bounds at `+Infinity`, upper bounds at `-Infinity`. */
export function boxEmpty(out: Float64Array, o: number) {
  out[o] = Infinity;
  out[o + 1] = Infinity;
  out[o + 2] = Infinity;
  out[o + 3] = -Infinity;
  out[o + 4] = -Infinity;
  out[o + 5] = -Infinity;
}

/** True when an upper bound falls below its lower bound. A NaN bound does not make the box empty. */
export function boxIsEmpty(box: ArrayLike<number>, o: number) {
  return box[o + 3] < box[o] || box[o + 4] < box[o + 1] || box[o + 5] < box[o + 2];
}

/** Expands the box to contain a point. */
export function boxExpandByPoint(out: Float64Array, o: number, x: number, y: number, z: number) {
  out[o] = Math.min(out[o], x);
  out[o + 1] = Math.min(out[o + 1], y);
  out[o + 2] = Math.min(out[o + 2], z);
  out[o + 3] = Math.max(out[o + 3], x);
  out[o + 4] = Math.max(out[o + 4], y);
  out[o + 5] = Math.max(out[o + 5], z);
}

/** Union of the box with another given by its six bounds. */
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
 * The eight corners of a box transformed by `m` (4×4 column-major), written flat — twenty-four
 * floats starting at `o`. Corner `i` takes `max` on `x` when bit 1 is set, on `y`
 * for bit 2, on `z` for bit 4. Each corner is the homogeneous transformation of a point:
 * `(m·p) / (m₃·p)`, inverse of `w` computed once then multiplied.
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
 * Bounding box enclosing the image by `m` of `box`: union of its eight transformed corners. An
 * empty box stays as is, bounds included. `out` can be `box`: bounds are read
 * before the first write.
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
