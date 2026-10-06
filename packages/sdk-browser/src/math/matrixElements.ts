import { IDENTITY_MATRIX4, copyMatrix4 } from '../../../sdk-core/src/index.ts'

/**
 * Matrix sixteen floats, compared or copied: knowing if view moved, or if requested
 * pose is the one node already holds. Every caller wrote its own loop; they all read
 * the same arithmetic, float by float without tolerance.
 */
export function sameElements(held: ArrayLike<number>, now: ArrayLike<number>, heldAt = 0) {
  for (let i = 0; i < 16; i++) if (held[heldAt + i] !== now[i]) return false
  return true
}

/** True when the sixteen numbers of `now` are `held`'s, sign of zero and `NaN` included:
 *  `Object.is`, not `sameElements`' `!==`, which merges `-0` with `0` — two translations a zero's
 *  sign tells apart compose differently, and a `NaN` left in place is no change. */
export function sameMatrixBits(held: ArrayLike<number>, now: ArrayLike<number>) {
  for (let i = 0; i < 16; i++) if (!Object.is(held[i], now[i])) return false
  return true
}

/** One float32 step at magnitude 1: the GPU draws every world in float32. */
export const FLOAT32_STEP = 2 ** -23

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

/**
 * In both directions: HOST matrix copied into owned buffer, or core result set
 * into HOST matrix. Core only computes in `Float64Array` — single buffer type for
 * product and inverse (`packages/sdk-core/src/math/matrix/matrix4.ts`) — and host library matrices are plain arrays:
 * result destined for host is composed separately then copied here.
 */
export function copyElements(into: { [index: number]: number }, from: ArrayLike<number>) {
  copyMatrix4(into, from)
}

/**
 * Column-major 4×4 matrix owned by HOST — pose of a node in its scene. Engine only reads
 * its sixteen floats: no host library structure crosses a signature.
 */
export type MatrixElements = {
  /** The sixteen numbers, column by column. */
  readonly elements: ArrayLike<number>
}

/**
 * The same sixteen floats, WRITABLE term by term: the pose a boundary sets back on a host node
 * or on a host camera it restores. It is the mutable face of `MatrixElements` and lives beside
 * it; nothing asks the host to compose them — `copyElements` writes them as they stand.
 */
export type HostNodeMatrix = {
  /** The sixteen numbers, by index. */
  readonly elements: { [index: number]: number; readonly length: number }
}

export { IDENTITY_MATRIX4 as IDENTITY_ELEMENTS }
