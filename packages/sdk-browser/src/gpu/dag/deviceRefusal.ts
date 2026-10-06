import { cameraCutBuffers, pastBinding, readoutRow } from './bufferTable.ts'
import { dagPartCounts } from './split.ts'
import { dagBindEntries } from './shader/bindings.ts'
import type { PackedDag } from './types.ts'
import { type Limits } from './deviceListCap.ts'

/** Storage buffers per stage WebGPU guarantees every device. */
const GUARANTEED_STORAGE_BINDINGS = 8

/** The limits the device check reads: one binding's bytes, and the storage bindings per stage. */
type DagDeviceLimits = Limits & { maxStorageBuffersPerShaderStage?: number }

/**
 * WHAT OF A CAMERA CUT THIS DEVICE CANNOT HOLD, by name, or `undefined` when it holds it all. A
 * buffer past one binding would fail on the device — a bind group refused — and the GPU cut would
 * be gone without a word. Refused here, before any buffer, the host names it and the CPU cut draws.
 * `frames` and `worlds` are not checked: they split in ranges (`frameRanges.ts`), and a primitive's
 * pass runs once per range. `clusters`, `nodes`, `pageCones` and `flags` split in parts, bound at
 * once (`split.ts`): refused only when one part is still past a binding — one element, one flag
 * section —, or when the device cannot bind every part in one stage. No dispatch is: each runs in
 * rows past one dimension's workgroups (`shader/gridWgsl.ts`). The readout starts within one
 * binding and grows no further (`listCap.ts`): refused only if not one rank fits.
 */
export function dagDeviceRefusal(limits: DagDeviceLimits, packed: PackedDag) {
  const table = cameraCutBuffers(packed, limits)
  const past = pastBinding(limits, { ...table.rows, out: readoutRow(1) })
  if (past) return past
  // The layout's own storage bindings, split parts included: never a count of its own.
  const bindings = dagBindEntries(dagPartCounts(table.split)).filter(
      (entry) => entry.buffer?.type !== 'uniform',
    ).length,
    limit = limits?.maxStorageBuffersPerShaderStage ?? GUARANTEED_STORAGE_BINDINGS
  return bindings > limit ? { buffer: 'storage bindings', bindings, limit } : undefined
}
