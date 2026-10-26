import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { stagedOutputBytes } from './layout.ts'
import { OPEN_SLOT_WORDS } from './heldOpen.ts'
import { dagFlagShape } from './flagSections.ts'
import { cutListCaps, type CutListCaps } from './lists/cutListCaps.ts'
import { type PackedDag } from './types.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { visibleBytes, visibleLimit, INITIAL_VISIBLE } from './visible/layout.ts'
import { CLUSTER_EDGE_BYTES, CLUSTER_INFO_BYTES } from './info/clusterInfoLayout.ts'

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
 * of `work` (`dagWorkLayout`); `shape`, what its flags are laid out for at the lists' `caps`
 * (`flagSections.ts`). Its other tables are record tables (`cut/cutTables.ts`), but for the list of
 * visible clusters, at the room it starts with (`visible/layout.ts`), and the clusters' records
 * (`info/clusterInfoLayout.ts`), one for each page of each distinct page array the packing holds
 * room for.
 */
export function cameraCutBuffers(
  packed: Parameters<typeof dagFlagShape>[0] &
    Pick<PackedDag, 'nodeCount'> & { infoCount?: number },
  caps: CutListCaps = cutListCaps(),
) {
  const blockCount = ceilDiv(packed.pageCount, WORKGROUP_THREADS),
    workLayout = dagWorkLayout(blockCount, packed.worldCount ?? 0),
    visibleCap = Math.min(INITIAL_VISIBLE, visibleLimit(packed.pageCount, caps))
  return {
    blockCount,
    workLayout,
    /** What `flags` is laid out for: the cut's lists at their caps (`flagSections.ts`). */
    shape: dagFlagShape(packed, caps),
    /** The records the list of visible clusters starts with. */
    visibleCap,
    rows: {
      work: { label: 'Trillion3D DAG work', size: Math.max(8, workLayout.words * 4) },
      visible: visibleRow(visibleCap),
      info: {
        label: 'Trillion3D DAG cluster records',
        size: Math.max(
          CLUSTER_INFO_BYTES,
          (packed.infoCount ?? packed.pageCount) * CLUSTER_INFO_BYTES,
        ),
      },
      edges: {
        label: 'Trillion3D DAG cluster edges',
        size: Math.max(
          CLUSTER_EDGE_BYTES,
          (packed.infoCount ?? packed.pageCount) * CLUSTER_EDGE_BYTES,
        ),
      },
    } satisfies Record<string, DagBufferRow>,
  }
}

/** The list of visible clusters for `cap` records, as `createDagList` makes it: written by the cut,
 *  read by the visibility passes and copied by none. */
export const visibleRow = (cap: number): DagBufferRow => ({
  label: 'Trillion3D DAG visible clusters',
  size: visibleBytes(cap),
})

/** The readout of a cut whose list holds `listCap` ranks, then the `heldSlots` slots of the open
 *  counts placements hold (`heldOpen.ts`), as `createDagList` makes it (`lists/listCap.ts`). */
export const readoutRow = (listCap: number, heldSlots = 0): DagBufferRow => ({
  label: 'Trillion3D DAG readback',
  size: stagedOutputBytes(listCap) + heldSlots * OPEN_SLOT_WORDS * 4,
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
