import { cameraCutBuffers, pastBinding, readoutRow } from './bufferTable.ts';
import type { Limits } from './listCap.ts';
import type { PackedDag } from './types.ts';

/**
 * WHAT OF A CAMERA CUT THIS DEVICE CANNOT HOLD, by name, or `undefined` when it holds it all. A
 * buffer past one binding would fail on the device — a bind group refused — and the GPU cut would
 * be gone without a word. Refused here, before any buffer, the host names it and the CPU cut draws.
 * `frames` and `worlds` are not checked: they split in ranges (`frameRanges.ts`), and a primitive's
 * pass runs once per range. No dispatch is: each runs in rows past one dimension's workgroups
 * (`shader/gridWgsl.ts`). The readout starts within one binding and grows no further
 * (`listCap.ts`): refused only if not one rank fits.
 */
export function dagDeviceRefusal(limits: Limits, packed: PackedDag) {
  return pastBinding(limits, { ...cameraCutBuffers(packed).rows, out: readoutRow(1) });
}
