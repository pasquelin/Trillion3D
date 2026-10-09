import { FLOAT32_STEP } from '../constants.ts'

/**
 * Matrix sixteen floats, compared or copied: knowing if view moved, or if requested
 * pose is the one node already holds. Every caller wrote its own loop; they all read
 * the same arithmetic, float by float without tolerance.
 */
export function sameElements(
  held: ArrayLike<number>,
  now: ArrayLike<number>,
  heldAt = 0,
  nowAt = 0,
) {
  for (let i = 0; i < 16; i++) if (held[heldAt + i] !== now[nowAt + i]) return false
  return true
}

/** The indices of a column-major matrix's linear part, its upper-left 3×3: what a stretch, a
 *  radius or an inverse without translation reads of it. */
export const LINEAR_PART = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const

/** True when the linear part of the matrix `now` holds from `nowAt` is the one `held` holds from
 *  `heldAt`, each number at its own index (`LINEAR_PART`), float for float: a pose that moved
 *  without turning or scaling. */
export function sameLinearPart(
  held: ArrayLike<number>,
  now: ArrayLike<number>,
  heldAt = 0,
  nowAt = 0,
) {
  for (const k of LINEAR_PART) if (held[heldAt + k] !== now[nowAt + k]) return false
  return true
}

/** `sameLinearPart` against float32 numbers: `held`'s are `now`'s rounded to float32. */
export function sameLinearPartFloat32(held: ArrayLike<number>, now: ArrayLike<number>, heldAt = 0) {
  for (const k of LINEAR_PART) if (held[heldAt + k] !== Math.fround(now[k])) return false
  return true
}

/** True when the sixteen numbers of `now` are `held`'s, sign of zero and `NaN` included:
 *  `Object.is`, not `sameElements`' `!==`, which merges `-0` with `0` — two translations a zero's
 *  sign tells apart compose differently, and a `NaN` left in place is no change. */
export function sameMatrixBits(held: ArrayLike<number>, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (!Object.is(held[i], now[i])) return false
  return true
}

/** True when the sixteen float32 numbers `held` holds from `heldAt` are those of `now` rounded to
 *  float32, `held[heldAt + i] === Math.fround(now[i])`: whether a double matrix still says what a
 *  GPU buffer already holds. By value: `-0` matches `0`, and a `NaN` never matches. */
export function sameMatrixFloat32(held: ArrayLike<number>, now: ArrayLike<number>, heldAt = 0) {
  for (let i = 0; i < 16; i++) if (held[heldAt + i] !== Math.fround(now[i])) return false
  return true
}

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
  let moved = 0,
    reach = 0
  for (let row = 0; row < 3; row++) {
    let shift = Math.abs(now[12 + row] - held[heldAt + 12 + row]),
      far = Math.abs(now[12 + row])
    for (let col = 0; col < 3; col++) {
      const extent = Math.max(Math.abs(box[col]), Math.abs(box[3 + col]))
      shift += Math.abs(now[col * 4 + row] - held[heldAt + col * 4 + row]) * extent
      far += Math.abs(now[col * 4 + row]) * extent
    }
    moved = Math.max(moved, shift)
    reach = Math.max(reach, far)
  }
  return moved < FLOAT32_STEP * reach
}

/** Whether `a` holds `b`'s values, as many: version lists and light reaches alike. */
export function sameValues(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
