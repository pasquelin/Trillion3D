import { cameraCutBuffers, pastBinding, readoutRow } from './bufferTable.ts'
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
 * be gone without a word. Refused here, before any buffer, the host names it and refuses the scene.
 * Its tables — the clusters, the nodes, the cold words, the flags, the frame words, the worlds and
 * the placement tree — are record tables (`cutTables.ts`), no storage binding: whatever the world,
 * the stage binds the readout and `work` alone. No dispatch is refused: each runs in rows
 * (`../dispatch/grid.ts`). The readout starts within one binding and grows no further
 * (`listCap.ts`): refused only if not one rank fits; `work`, a quarter of a byte a page, past it.
 */
export function dagDeviceRefusal(limits: DagDeviceLimits, packed: PackedDag) {
  const table = cameraCutBuffers(packed, limits)
  const past = pastBinding(limits, { ...table.rows, out: readoutRow(1) })
  if (past) return past
  // The layout's own storage bindings: never a count of its own.
  const bindings = dagBindEntries().filter(
      (entry) => entry.buffer && entry.buffer.type !== 'uniform',
    ).length,
    limit = limits?.maxStorageBuffersPerShaderStage ?? GUARANTEED_STORAGE_BINDINGS
  return bindings > limit ? { buffer: 'storage bindings', bindings, limit } : undefined
}
