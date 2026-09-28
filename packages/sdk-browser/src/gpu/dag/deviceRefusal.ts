import { SELECTION_WORKGROUP } from '../core/selection.ts';
import { cameraCutBuffers, pastBinding, readoutRow } from './bufferTable.ts';
import { cameraFrameRanges } from './frameRanges.ts';
import type { Limits } from './listCap.ts';
import type { PackedDag } from './types.ts';

/**
 * WHAT OF A CAMERA CUT THIS DEVICE CANNOT HOLD, by name, or `undefined` when it holds it all. A
 * buffer past one binding, or a flat dispatch past the workgroups of one dimension, would fail on
 * the device — a bind group refused, a dispatch skipped — and the GPU cut would be gone without a
 * word. Refused here, before any buffer, the host names it and the CPU cut draws. `frames` and
 * `worlds` are not checked: they split in ranges (`frameRanges.ts`), and a primitive's pass runs
 * once per range. The readout starts within one binding and grows no further (`listCap.ts`).
 */
export function dagDeviceRefusal(
  limits: Limits & { maxComputeWorkgroupsPerDimension?: number },
  packed: PackedDag,
) {
  const { pageCount, nodeCount, worldCount } = packed;
  // The readout starts within one binding (`initialListCap`): refused only if not one rank fits.
  const past = pastBinding(limits, { ...cameraCutBuffers(packed).rows, out: readoutRow(1) });
  if (past) return past;
  // One thread per page, node or primitive of a range, flat along x: the widest pass (`encode.ts`).
  const perRange = cameraFrameRanges(limits, worldCount)[0]?.count ?? 0,
    workgroups = Math.ceil(Math.max(pageCount, nodeCount, perRange) / SELECTION_WORKGROUP),
    most = limits.maxComputeWorkgroupsPerDimension ?? Infinity;
  if (workgroups > most) return { dispatch: 'workgroups', workgroups, limit: most };
  return undefined;
}
