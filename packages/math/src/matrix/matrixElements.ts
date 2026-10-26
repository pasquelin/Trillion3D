import { FLOAT32_STEP } from '../constants.ts'
import { boxAxisMagnitude, rowReach } from '../geometry/box.ts'

/** Whether the `count` numbers `a` holds from `aAt` are those `b` holds from `bAt`, each `!==`:
 *  `-0` matches `0` and a `NaN` never matches. The one equality loop of numbers. */
export function sameRange<T>(a: ArrayLike<T>, b: ArrayLike<T>, count: number, aAt = 0, bAt = 0) {
  for (let i = 0; i < count; i++) if (a[aAt + i] !== b[bAt + i]) return false
  return true
}

/** `sameRange` against float32 numbers: `held`'s are `now`'s rounded to float32,
 *  `held[heldAt + i] === Math.fround(now[nowAt + i])`. */
function sameRangeFloat32(
  held: ArrayLike<number>,
  now: ArrayLike<number>,
  count: number,
  heldAt = 0,
  nowAt = 0,
) {
  for (let i = 0; i < count; i++) if (held[heldAt + i] !== Math.fround(now[nowAt + i])) return false
  return true
}

/**
 * Matrix sixteen floats, compared: knowing if view moved, or if requested pose is the one node
 * already holds (`sameRange` of sixteen), float by float without tolerance.
 */
export const sameElements = (
  held: ArrayLike<number>,
  now: ArrayLike<number>,
  heldAt = 0,
  nowAt = 0,
) => sameRange(held, now, 16, heldAt, nowAt)

/** True when the linear part — the upper-left 3×3 of a column-major matrix — of the matrix `now`
 *  holds from `nowAt` is the one `held` holds from `heldAt`, each number at its own index: its three
 *  columns, `sameRange` each. A pose that moved without turning or scaling. */
export const sameLinearPart = (
  held: ArrayLike<number>,
  now: ArrayLike<number>,
  heldAt = 0,
  nowAt = 0,
) =>
  sameRange(held, now, 3, heldAt, nowAt) &&
  sameRange(held, now, 3, heldAt + 4, nowAt + 4) &&
  sameRange(held, now, 3, heldAt + 8, nowAt + 8)

/** True when the sixteen numbers of `now` are `held`'s, sign of zero and `NaN` included:
 *  `Object.is`, not `sameRange`'s `!==`, which merges `-0` with `0` — two translations a zero's
 *  sign tells apart compose differently, and a `NaN` left in place is no change. */
export function sameMatrixBits(held: ArrayLike<number>, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (!Object.is(held[i], now[i])) return false
  return true
}

/** True when the sixteen float32 numbers `held` holds from `heldAt` are those of `now` rounded to
 *  float32 (`sameRangeFloat32` of sixteen): whether a double matrix still says what a GPU buffer
 *  already holds. */
export const sameMatrixFloat32 = (held: ArrayLike<number>, now: ArrayLike<number>, heldAt = 0) =>
  sameRangeFloat32(held, now, 16, heldAt)

/**
 * Whether pose `now` leaves local box `box` (its min, then its max) where pose `held` (at
 * `heldAt`) put it: no corner of it moves by one float32 step at the box's own reach in world. A
 * change below that is one the float32 world the GPU draws with cannot show — a resting body's
 * pose rounded again in float64 — and is no move. The bound follows the box, never a scene.
 */
export function poseHoldsBox(
  held: ArrayLike<number>,
  now: ArrayLike<number>,
  box: ArrayLike<number>,
  heldAt = 0,
) {
  if (sameElements(held, now, heldAt)) return true
  for (let i = 3; i < 16; i += 4) if (held[heldAt + i] !== now[i]) return false
  const x = boxAxisMagnitude(box, 0),
    y = boxAxisMagnitude(box, 1),
    z = boxAxisMagnitude(box, 2)
  let moved = 0,
    reach = 0
  for (let row = 0; row < 3; row++) {
    let shift = Math.abs(now[12 + row] - held[heldAt + 12 + row])
    shift += Math.abs(now[row] - held[heldAt + row]) * x
    shift += Math.abs(now[4 + row] - held[heldAt + 4 + row]) * y
    shift += Math.abs(now[8 + row] - held[heldAt + 8 + row]) * z
    moved = Math.max(moved, shift)
    reach = Math.max(reach, rowReach(now, row, x, y, z))
  }
  return moved < FLOAT32_STEP * reach
}

/** Whether `a` holds `b`'s values, as many, each `===`: version lists, light reaches and GPU
 *  binding entries alike. */
export const sameValues = <T>(a: ArrayLike<T>, b: ArrayLike<T>) =>
  a.length === b.length && sameRange(a, b, a.length)
