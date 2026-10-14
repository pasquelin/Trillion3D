import { WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { stagedOutputBytes } from './layout.ts'
import { OPEN_SLOT_WORDS } from './heldOpen.ts'
import { dagFlagShape } from './flagSections.ts'
import { type PackedDag } from './types.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/** One storage buffer of a cut: its label, its bytes, and whether a copy reads it. */
export type DagBufferRow = { label: string; size: number; copySource?: boolean }

/** `row` made a buffer by `make` — a device's `createBuffer`, or a cut's own (`resources.ts`). */
export const makeDagBuffer = (make: (d: GPUBufferDescriptor) => GPUBuffer, row: DagBufferRow) =>
  make({
    label: row.label,
    size: row.size,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      (row.copySource ? GPUBufferUsage.COPY_SRC : 0),
  })

/**
 * THE BUFFERS OF A CAMERA CUT, as `createDagResources` makes them: one table read by the resources
 * and by the device check (`deviceRefusal.ts`), so the check can never judge a size the cut does
 * not ask for. `blockCount` is the kernel's `blockCount()`, word for word, and `workLayout` the layout
 * of `work` (`dagWorkLayout`); `shape`, what its flags are laid out for as the cut starts
 * (`flagSections.ts`). Its other tables are record tables, no storage buffer (`cutTables.ts`).
 */
export function cameraCutBuffers(
  packed: Pick<PackedDag, 'pageCount' | 'nodeCount' | 'worldCount'> &
    Partial<Pick<PackedDag, 'entryCount' | 'candCount' | 'groupCount'>>,
  limits?: Parameters<typeof storageBufferCap>[0],
) {
  const blockCount = ceilDiv(packed.pageCount, WORKGROUP_THREADS),
    workLayout = dagWorkLayout(blockCount, packed.groupCount)
  return {
    blockCount,
    workLayout,
    /** What `flags` is laid out for: the cut's queues and lists as they start (`queueGrowth.ts`). */
    shape: dagFlagShape(packed, limits),
    rows: {
      work: { label: 'Trillion3D DAG work', size: Math.max(8, workLayout.words * 4) },
    } satisfies Record<string, DagBufferRow>,
  }
}

/** The readout of a cut whose list holds `listCap` ranks and `regions` saved journals, then the
 *  `heldSlots` slots of the open counts placements hold (`heldOpen.ts`), as `createDagList` makes
 *  it (`listCap.ts`). */
export const readoutRow = (listCap: number, regions = 0, heldSlots = 0): DagBufferRow => ({
  label: 'Trillion3D DAG readback',
  size: stagedOutputBytes(listCap, regions) + heldSlots * OPEN_SLOT_WORDS * 4,
  copySource: true,
})

/** THE ONE FIT RULE of a cut's buffers: the first of `rows` past one storage binding of this
 *  device, by name, or `undefined` when the device holds them all. */
export function pastBinding(
  limits: Parameters<typeof storageBufferCap>[0],
  rows: Record<string, DagBufferRow>,
) {
  const limit = storageBufferCap(limits)
  for (const [buffer, { size }] of Object.entries(rows))
    if (size > limit) return { buffer, bytes: size, limit }
  return undefined
}
