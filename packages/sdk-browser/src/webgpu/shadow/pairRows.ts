import { KEPT_ROW_BYTES as ROW_BYTES } from '../../gpu/shadow/keptList.ts';
import { storageBufferCap } from '../../residency/pools.ts';

/** Bytes of a kept pair: its region, its row. */
const PAIR_BYTES = 8;
/** Rows asked at once: a need growing pair by pair asks the device rarely. */
const ROW_STEP = 64;

/** Pairs a kept list of `rows` rows a region holds. */
export const keptPairs = (rows: number) => Math.floor((rows * ROW_BYTES) / PAIR_BYTES);

/** The rows a region of the kept list holds: the table's `casterSlots`, or more for the GPU pages'
 *  `need` pairs — by `ROW_STEP` —, never past what one storage binding holds. */
export function keptRows(casterSlots: number, need: number, limits?: GPUSupportedLimits) {
  const asked = ROW_STEP * Math.ceil((need * PAIR_BYTES) / (ROW_BYTES * ROW_STEP));
  return Math.max(casterSlots, Math.min(asked, Math.floor(storageBufferCap(limits) / ROW_BYTES)));
}
