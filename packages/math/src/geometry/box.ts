import type { NumberSink } from '../matrix/matrix4.ts'
import { length3, transformPointRow } from '../vector/vector.ts'
import { sameRange } from '../matrix/matrixElements.ts'

/**
 * Axis-aligned bounding boxes, stored flat: six floats `minX, minY, minZ, maxX, maxY, maxZ`
 * starting at an offset. Free functions, output passed as parameter, zero allocation.
 *
 * Each operation keeps one fixed arithmetic, term by term — `Math.min` and
 * `Math.max` component-wise, homogeneous transformation of the eight corners with division by
 * `w` — to yield the exact same bits, including NaN, signed zeroes, and infinities.
 */

/** Floats of a box stored flat. */
export const BOX_VALUES = 6

/** Sets an empty box: lower bounds at `+Infinity`, upper bounds at `-Infinity`. */
export function boxEmpty(out: Float64Array, o: number) {
  out[o] = Infinity
  out[o + 1] = Infinity
  out[o + 2] = Infinity
  out[o + 3] = -Infinity
  out[o + 4] = -Infinity
  out[o + 5] = -Infinity
}

/** True when an upper bound falls below its lower bound; a NaN bound does not make it empty. */
export function boundsAreEmpty(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  return maxX < minX || maxY < minY || maxZ < minZ
}

/** Writes the six bounds into `out` at `o`: the one way the folds below store a box. */
function writeBounds(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  out[o] = minX
  out[o + 1] = minY
  out[o + 2] = minZ
  out[o + 3] = maxX
  out[o + 4] = maxY
  out[o + 5] = maxZ
}

/** True when an upper bound falls below its lower bound. A NaN bound does not make the box empty. */
export function boxIsEmpty(box: ArrayLike<number>, o: number) {
  return boundsAreEmpty(box[o], box[o + 1], box[o + 2], box[o + 3], box[o + 4], box[o + 5])
}

/** The centre of the box given by its six bounds, `(min + max) * 0.5` per axis, into `out` at
 *  `o`. No empty test: the caller decides what an empty box's centre is. */
export function boxCenter(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  out[o] = (minX + maxX) * 0.5
  out[o + 1] = (minY + maxY) * 0.5
  out[o + 2] = (minZ + maxZ) * 0.5
}

/** The centre of the box at `box[bo]` relative to the point `(x, y, z)`, into `out` at `o`: per axis
 *  `(min − p + (max − p)) / 2`, each bound moved before the sum, so a box far from the origin keeps
 *  the digits of its offset near `p`. No empty test. */
export function boxCenterFrom<T extends NumberSink>(
  out: T,
  o: number,
  box: ArrayLike<number>,
  bo: number,
  x: number,
  y: number,
  z: number,
) {
  out[o] = (box[bo] - x + (box[bo + 3] - x)) / 2
  out[o + 1] = (box[bo + 1] - y + (box[bo + 4] - y)) / 2
  out[o + 2] = (box[bo + 2] - z + (box[bo + 5] - z)) / 2
  return out
}

/** True when `(x, y, z)` lies in the box at `o`, its faces included. Each test is a strict
 *  comparison denied: one with a NaN coordinate or bound is false, so it never puts a point out. */
export function boxContainsPoint(
  box: ArrayLike<number>,
  o: number,
  x: number,
  y: number,
  z: number,
) {
  return !(
    x < box[o] ||
    x > box[o + 3] ||
    y < box[o + 1] ||
    y > box[o + 4] ||
    z < box[o + 2] ||
    z > box[o + 5]
  )
}

/** True when the boxes `a` at `ao` and `b` at `bo` overlap, touching faces included: no axis has
 *  one box's upper bound under the other's lower. A `boxEmpty` box, its bounds infinite and
 *  inverted, overlaps nothing; a finite inverted box is not empty here and overlaps whatever
 *  spans its bounds. A comparison with a NaN bound is false, so it never separates them. */
export function boxesOverlap(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) {
  return !(
    b[bo + 3] < a[ao] ||
    b[bo] > a[ao + 3] ||
    b[bo + 4] < a[ao + 1] ||
    b[bo + 1] > a[ao + 4] ||
    b[bo + 5] < a[ao + 2] ||
    b[bo + 2] > a[ao + 5]
  )
}

/** True when boxes `a` at `ao` and `b` at `bo` hold the same six values, bit for bit. */
export const boxEquals = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) =>
  sameRange(a, b, BOX_VALUES, ao, bo)

/** Expands the box to contain a point: the union with the box of that point alone. */
export function boxExpandByPoint(out: Float64Array, o: number, x: number, y: number, z: number) {
  boxUnion(out, o, x, y, z, x, y, z)
}

/**
 * The smallest box around `count` points read from `points` at `at`, one every `stride` numbers,
 * into `out` at `o`: `boxEmpty`, then `boxExpandByPoint` per point, the engine's one fold. `Math.min` and `Math.max` decide, so a NaN coordinate makes its bounds NaN,
 * `-0` sits below `+0`, and no point leaves the box empty. `out` must not be `points`.
 */
export function boxFromPoints(
  out: Float64Array,
  o: number,
  points: ArrayLike<number>,
  at: number,
  count: number,
  stride = 3,
) {
  boxEmpty(out, o)
  for (let i = 0, p = at; i < count; i++, p += stride)
    boxExpandByPoint(out, o, points[p], points[p + 1], points[p + 2])
}

/** The box at `bo` of `box` grown by `g` on every side, into `out` at `o` (the same box allowed):
 *  each axis's lower then upper bound, axis by axis. */
export function boxGrow(
  out: Float64Array,
  o: number,
  box: ArrayLike<number>,
  bo: number,
  g: number,
) {
  out[o] = box[bo] - g
  out[o + 3] = box[bo + 3] + g
  out[o + 1] = box[bo + 1] - g
  out[o + 4] = box[bo + 4] + g
  out[o + 2] = box[bo + 2] - g
  out[o + 5] = box[bo + 5] + g
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
  out[o] = Math.min(out[o], minX)
  out[o + 1] = Math.min(out[o + 1], minY)
  out[o + 2] = Math.min(out[o + 2], minZ)
  out[o + 3] = Math.max(out[o + 3], maxX)
  out[o + 4] = Math.max(out[o + 4], maxY)
  out[o + 5] = Math.max(out[o + 5], maxZ)
}

/**
 * Whether every corner of the box of bounds `min…max` has `w` exactly 1 under `m`: the last row
 * of `m` is `0, 0, 0, 1` and every bound finite, so each product of the row is a zero and their sum
 * plus 1 is 1. The divide by `w` is then skipped, and so is the product by `1 / w`, which leaves
 * every value — NaN, signed zero and infinity — as it is.
 */
function unitW(
  m: ArrayLike<number>,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  return (
    m[3] === 0 &&
    m[7] === 0 &&
    m[11] === 0 &&
    m[15] === 1 &&
    Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(minZ) &&
    Number.isFinite(maxX) &&
    Number.isFinite(maxY) &&
    Number.isFinite(maxZ)
  )
}

/**
 * The eight corners of a box transformed by `m` (4×4 column-major), written flat — twenty-four
 * floats starting at `o`. Corner `i` takes `max` on `x` when bit 1 is set, on `y`
 * for bit 2, on `z` for bit 4. Each corner is the homogeneous transformation of a point:
 * `(m·p) / (m₃·p)`, each row `transformPointRow`, inverse of `w` computed once then multiplied.
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
      lz = i & 4 ? maxZ : minZ
    const mw = 1 / transformPointRow(m, 3, lx, ly, lz)
    const at = o + i * 3
    out[at] = transformPointRow(m, 0, lx, ly, lz) * mw
    out[at + 1] = transformPointRow(m, 1, lx, ly, lz) * mw
    out[at + 2] = transformPointRow(m, 2, lx, ly, lz) * mw
  }
}

/**
 * Bounding box enclosing the image by `m` of `box`: union of its eight transformed corners. An
 * empty box stays as is, bounds included. `out` can be `box`: bounds are read
 * before the first write.
 *
 * Each corner is computed into locals and folded into `out` by `boxExpandByPoint`, corners in the
 * order of `boxCornersInto`, from an empty box: the bits of the union of `boxCornersInto`'s
 * corners (`box.test.ts`). Where `unitW` holds, the divide by `w` is skipped as there.
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
    maxZ = box[bo + 5]
  if (boundsAreEmpty(minX, minY, minZ, maxX, maxY, maxZ)) {
    writeBounds(out, o, minX, minY, minZ, maxX, maxY, maxZ)
    return
  }
  const m0 = m[0],
    m1 = m[1],
    m2 = m[2],
    m3 = m[3],
    m4 = m[4],
    m5 = m[5],
    m6 = m[6],
    m7 = m[7],
    m8 = m[8],
    m9 = m[9],
    m10 = m[10],
    m11 = m[11],
    m12 = m[12],
    m13 = m[13],
    m14 = m[14],
    m15 = m[15]
  const affine = unitW(m, minX, minY, minZ, maxX, maxY, maxZ)
  // The bounds are held in locals, so `out` may be `box`: emptied, then grown corner by corner.
  boxEmpty(out, o)
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? maxX : minX,
      ly = i & 2 ? maxY : minY,
      lz = i & 4 ? maxZ : minZ
    let x = transformPointRow(m, 0, lx, ly, lz),
      y = transformPointRow(m, 1, lx, ly, lz),
      z = transformPointRow(m, 2, lx, ly, lz)
    if (!affine) {
      const mw = 1 / transformPointRow(m, 3, lx, ly, lz)
      x *= mw
      y *= mw
      z *= mw
    }
    boxExpandByPoint(out, o, x, y, z)
  }
}

/** The length of the diagonal of the box of bounds `min…max`, `length3(max − min)` axis by axis.
 *  No empty test: the caller decides what an empty box's diagonal is. */
export const boundsDiagonal = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) => length3(maxX - minX, maxY - minY, maxZ - minZ)

/** `boundsDiagonal` of the box at `box[o]`. */
export const boxDiagonal = (box: ArrayLike<number>, o = 0) =>
  boundsDiagonal(box[o], box[o + 1], box[o + 2], box[o + 3], box[o + 4], box[o + 5])

/** The radius of the sphere about the box at `box[o]`, centred at the box's centre: half its
 *  diagonal, `boxDiagonal · 0.5`, the radius `sphereFromBounds` writes. No empty test. */
export const boxRadius = (box: ArrayLike<number>, o = 0) => boxDiagonal(box, o) * 0.5
