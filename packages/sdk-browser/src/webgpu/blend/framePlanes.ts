import { f32Bits } from '../../../../math/src/float/bits.ts'
import { FRAME_HEAD, PLANE_USABLE } from './frameHead.ts'

/** A double the verdict takes in single precision lies below `2^SINGLE_BOUND_LOG2` in magnitude:
 *  a box bound brought to the eye then stays below 2⁶¹, a product of two below 2¹²¹, a sum of four
 *  below 2¹²³ — far from the single's overflow at 2¹²⁸. */
export const SINGLE_BOUND_LOG2 = 60
const SINGLE_BOUND = 2 ** SINGLE_BOUND_LOG2
/** The raise of a plane's offset brought to the eye, per unit of its magnitude: `8·2⁻⁵³`, past
 *  the `γ₄ ≈ 4·2⁻⁵³` the double products and sums can move it by, and the raise's own two
 *  roundings. */
const OFFSET_SLACK = 2 ** -50
/** The raise's absolute floor: a product or sum below the doubles' normal range loses `2⁻¹⁰⁷⁵`. */
const OFFSET_FLOOR = 2 ** -1000

const bounded = (v: number) => Math.abs(v) < SINGLE_BOUND

/**
 * The six frustum planes `planes` (`a, b, c, d` each, as `frustumExcludesBox` reads them) brought
 * to `eye` and rounded once to single precision, into the frame head (`FRAME_HEAD.planes`), with
 * their forward-corner words (`FRAME_HEAD.sides`): what the verdict tests a box brought to the eye
 * with (`verdictWgsl.ts`), the same for every workgroup of the frame.
 *
 * A plane keeps its normal; its offset becomes its value at the eye,
 * `d' = a·eₓ + b·e_y + c·e_z + d`, computed in doubles then RAISED by
 * `2⁻⁵⁰·(|a·eₓ| + |b·e_y| + |c·e_z| + |d|) + 2⁻¹⁰⁰⁰`, which covers every rounding of that sum: the
 * raised offset is at least the exact one, so a box the raised plane leaves behind lies behind the
 * exact plane — the raise only keeps more. A plane with a number past `2^SINGLE_BOUND_LOG2`, an
 * infinity or a NaN — or an eye with one — rejects nothing: its word clears `PLANE_USABLE` and its
 * numbers are zero, never entering the single arithmetic.
 */
export function writeFramePlanes(
  words: Uint32Array,
  planes: ArrayLike<number>,
  eye: ArrayLike<number>,
) {
  const ex = eye[0],
    ey = eye[1],
    ez = eye[2]
  const eyeBounded = bounded(ex) && bounded(ey) && bounded(ez)
  for (let p = 0; p < 6; p++) {
    const a = planes[p * 4],
      b = planes[p * 4 + 1],
      c = planes[p * 4 + 2],
      d = planes[p * 4 + 3]
    const ax = a * ex,
      by = b * ey,
      cz = c * ez
    const magnitude = Math.abs(ax) + Math.abs(by) + Math.abs(cz) + Math.abs(d)
    const offset = ax + by + cz + d + OFFSET_SLACK * magnitude + OFFSET_FLOOR
    const usable =
      eyeBounded && bounded(a) && bounded(b) && bounded(c) && bounded(d) && bounded(offset)
    const at = FRAME_HEAD.planes + p * 4
    words[at] = usable ? f32Bits(a) : 0
    words[at + 1] = usable ? f32Bits(b) : 0
    words[at + 2] = usable ? f32Bits(c) : 0
    words[at + 3] = usable ? f32Bits(offset) : 0
    words[FRAME_HEAD.sides + p] = usable
      ? PLANE_USABLE | (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0)
      : 0
  }
}
