import { storageBufferCap } from '../../residency/pools.ts'
import { SELECTION_WORKGROUP } from '../core/selection.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { stagedOutputBytes } from './layout.ts'
import { OPEN_SLOT_WORDS } from './heldOpen.ts'
import { dagFlagShape, flagShapeWords, type FlagShape } from './flagSections.ts'
import { type PackedDag } from './types.ts'
import { ELEMENT_BYTES, dagSplit, flagPartWords } from './split.ts'
import { type TableSplit } from './splitFlags.ts'
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

/** The rows of a table in parts of `per` elements of `bytes` each, over `total` bytes: the first
 *  under `row`'s label, the others numbered behind it. A whole table is `row` itself. */
function partRows(row: DagBufferRow, total: number, per: number, parts: number) {
  if (parts === 1) return [row]
  return Array.from({ length: parts }, (_, k) => ({
    ...row,
    label: k ? `${row.label} ${k}` : row.label,
    size: Math.min(per, total - k * per),
  }))
}

/** Each part of `parts` a row of the one table, named `name`, `name1`… as the kernel binds them. */
const namedParts = (name: string, parts: DagBufferRow[]) =>
  Object.fromEntries(parts.map((row, k) => [k ? `${name}${k}` : name, row]))

/**
 * THE BUFFERS OF A CAMERA CUT, as `createDagResources` makes them: one table read by the resources
 * and by the device check (`deviceRefusal.ts`), so the check can never judge a size the cut does
 * not ask for. `blockCount` is the kernel's `blockCount()`, word for word, and `workLayout` the layout
 * of `work` (`dagWorkLayout`). On `limits`, a table past one binding is in parts (`split.ts`):
 * `parts` the rows of each, `rows` all of them, each part one row.
 */
export function cameraCutBuffers(
  packed: Pick<
    PackedDag,
    'pageCount' | 'nodeCount' | 'worldCount' | 'clusters' | 'nodes' | 'pageCones'
  > &
    Partial<Pick<PackedDag, 'entryCount' | 'candCount' | 'groupCount'>>,
  limits?: Parameters<typeof storageBufferCap>[0],
) {
  const blockCount = ceilDiv(packed.pageCount, SELECTION_WORKGROUP),
    workLayout = dagWorkLayout(blockCount, packed.groupCount)
  const shape = dagFlagShape(packed),
    flagWords = flagShapeWords(shape)
  const split = dagSplit(limits, packed, {
    clusters: packed.clusters.byteLength,
    nodes: packed.nodes.byteLength,
    cold: packed.pageCones.byteLength,
  })
  // The placement tree's nodes and members are copied out for the proxy's readers (`proxyInstances.ts`).
  const table = (
    label: string,
    bytes: number,
    least: number,
    part: TableSplit,
    element: number,
    copySource = false,
  ) =>
    partRows(
      { label, size: Math.max(least, bytes), ...(copySource ? { copySource } : {}) },
      bytes,
      part.per * element,
      part.parts,
    )
  const parts = {
    clusters: table(
      'Trillion3D DAG clusters',
      packed.clusters.byteLength,
      64,
      split.clusters,
      ELEMENT_BYTES.clusters,
    ),
    nodes: table(
      'Trillion3D DAG nodes',
      packed.nodes.byteLength,
      64,
      split.nodes,
      ELEMENT_BYTES.nodes,
      true,
    ),
    pageCones: table(
      'Trillion3D DAG page cones',
      packed.pageCones.byteLength,
      48,
      split.cold,
      ELEMENT_BYTES.cold,
      true,
    ),
    flags: flagRows('Trillion3D DAG flags', split.flagCuts, shape, flagWords, true),
  }
  return {
    blockCount,
    workLayout,
    split,
    /** What `flags` is laid out for: the cut's queues and lists as they start (`queueGrowth.ts`). */
    shape,
    parts,
    rows: {
      ...namedParts('clusters', parts.clusters),
      ...namedParts('nodes', parts.nodes),
      ...namedParts('pageCones', parts.pageCones),
      ...namedParts('flags', parts.flags),
      work: { label: 'Trillion3D DAG work', size: Math.max(8, workLayout.words * 4) },
    } satisfies Record<string, DagBufferRow>,
  }
}

/** The rows of a `flags` of `shape`, `words` in all, cut at `cuts` (`split.ts`); a camera's are copy
 *  sources. */
function flagRows(
  label: string,
  cuts: readonly number[],
  shape: FlagShape,
  words: number,
  copySource?: true,
): DagBufferRow[] {
  const sizes = flagPartWords(cuts, shape, words)
  return sizes.map((part, k) => ({
    label: k ? `${label} ${k}` : label,
    size: Math.max(16, part * 4),
    ...(copySource && { copySource }),
  }))
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
