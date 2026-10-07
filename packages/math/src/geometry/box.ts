import type { NumberSink } from '../matrix/matrix4.ts'
import { length3 } from '../vector/vector.ts'

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

/** True when an upper bound falls below its lower bound. A NaN bound does not make the box empty. */
export function boxIsEmpty(box: ArrayLike<number>, o: number) {
  return box[o + 3] < box[o] || box[o + 4] < box[o + 1] || box[o + 5] < box[o + 2]
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
export function boxEquals(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number) {
  for (let v = 0; v < BOX_VALUES; v++) if (a[ao + v] !== b[bo + v]) return false
  return true
}

/** Expands the box to contain a point. */
export function boxExpandByPoint(out: Float64Array, o: number, x: number, y: number, z: number) {
  out[o] = Math.min(out[o], x)
  out[o + 1] = Math.min(out[o + 1], y)
  out[o + 2] = Math.min(out[o + 2], z)
  out[o + 3] = Math.max(out[o + 3], x)
  out[o + 4] = Math.max(out[o + 4], y)
  out[o + 5] = Math.max(out[o + 5], z)
}

/**
 * The smallest box around `count` points read from `points` at `at`, one every `stride` numbers,
 * into `out` at `o`: `boxEmpty`, then `boxExpandByPoint` per point. `Math.min` and `Math.max` decide,
 * so a NaN coordinate makes its bounds NaN, `-0` sits below `+0`, and no point leaves the box
 * empty. `out` must not be `points`.
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

/** The box at `bo` of `box` grown by `g` on every side, into `out` at `o` (the same box allowed). */
export function boxGrow(
  out: Float64Array,
  o: number,
  box: ArrayLike<number>,
  bo: number,
  g: number,
) {
  for (let c = 0; c < 3; c++) {
    out[o + c] = box[bo + c] - g
    out[o + c + 3] = box[bo + c + 3] + g
  }
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
      lz = i & 4 ? maxZ : minZ
    const mw = 1 / (m[3] * lx + m[7] * ly + m[11] * lz + m[15])
    const at = o + i * 3
    out[at] = (m[0] * lx + m[4] * ly + m[8] * lz + m[12]) * mw
    out[at + 1] = (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * mw
    out[at + 2] = (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * mw
  }
}

/**
 * Bounding box enclosing the image by `m` of `box`: union of its eight transformed corners. An
 * empty box stays as is, bounds included. `out` can be `box`: bounds are read
 * before the first write.
 *
 * Each corner is computed into locals and folded at once into the six bounds, with the
 * `Math.min`/`Math.max` of `boxExpandByPoint`, corners in the order of `boxCornersInto`, from an
 * empty box: the bits of the union of `boxCornersInto`'s corners, with no scratch buffer
 * (`box.test.ts`).
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
  if (maxX < minX || maxY < minY || maxZ < minZ) {
    out[o] = minX
    out[o + 1] = minY
    out[o + 2] = minZ
    out[o + 3] = maxX
    out[o + 4] = maxY
    out[o + 5] = maxZ
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
  let loX = Infinity,
    loY = Infinity,
    loZ = Infinity,
    hiX = -Infinity,
    hiY = -Infinity,
    hiZ = -Infinity
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? maxX : minX,
      ly = i & 2 ? maxY : minY,
      lz = i & 4 ? maxZ : minZ
    const mw = 1 / (m3 * lx + m7 * ly + m11 * lz + m15)
    const x = (m0 * lx + m4 * ly + m8 * lz + m12) * mw,
      y = (m1 * lx + m5 * ly + m9 * lz + m13) * mw,
      z = (m2 * lx + m6 * ly + m10 * lz + m14) * mw
    loX = Math.min(loX, x)
    loY = Math.min(loY, y)
    loZ = Math.min(loZ, z)
    hiX = Math.max(hiX, x)
    hiY = Math.max(hiY, y)
    hiZ = Math.max(hiZ, z)
  }
  out[o] = loX
  out[o + 1] = loY
  out[o + 2] = loZ
  out[o + 3] = hiX
  out[o + 4] = hiY
  out[o + 5] = hiZ
}

/** Distance from the point `(x, y, z)` to the box, 0 inside it: the gap past each face: the distance of the
 *  clamped point. */
export function boxPointDistance(
  box: ArrayLike<number>,
  o: number,
  x: number,
  y: number,
  z: number,
) {
  const dx = Math.max(box[o] - x, 0, x - box[o + 3]),
    dy = Math.max(box[o + 1] - y, 0, y - box[o + 4]),
    dz = Math.max(box[o + 2] - z, 0, z - box[o + 5])
  return length3(dx, dy, dz)
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

/**
 * The half extents of the box of half extents `hx, hy, hz` carried by the linear part of the
 * column-major `m`, into `out[o..o + 2]`: per axis the absolute row of `m` against them,
 * `|m[r]|·hx + |m[4 + r]|·hy + |m[8 + r]|·hz`, summed left to right. The box about the image of a
 * box's centre with these half extents holds the image of the whole box.
 */
export function transformHalfExtent<T extends NumberSink>(
  out: T,
  o: number,
  m: ArrayLike<number>,
  hx: number,
  hy: number,
  hz: number,
) {
  out[o] = Math.abs(m[0]) * hx + Math.abs(m[4]) * hy + Math.abs(m[8]) * hz
  out[o + 1] = Math.abs(m[1]) * hx + Math.abs(m[5]) * hy + Math.abs(m[9]) * hz
  out[o + 2] = Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz
  return out
}
