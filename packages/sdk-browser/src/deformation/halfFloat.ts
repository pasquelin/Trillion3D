import { fromHalf, toHalf } from '../../../sdk-core/src/lighting/ltcTable.ts';

/** A half float's value from its sixteen bits, positive ones: what `unpack2x16float` reads. */
const halfValue = (bits: number) => (bits >= 0x7c00 ? Infinity : fromHalf(bits));

/** The smallest half float at or above `x`, as its sixteen bits: a reach the GPU cut reads never
 *  below the one the CPU cut grows by; past the largest finite half, infinity. */
function halfAtLeast(x: number) {
  if (!(x > 0)) return 0;
  if (x > 65504) return 0x7c00;
  // The nearest half is one of the two around `x`: the one below steps up to the one above.
  let bits = toHalf(x);
  while (halfValue(bits) < x) bits++;
  return bits;
}

/** `mark` with `reach` in its high sixteen bits, as the GPU cut reads it (`reachOf`, #357). */
export const markReach = (mark: number, reach: number) =>
  ((mark & 0xffff) | (halfAtLeast(reach) << 16)) >>> 0;
