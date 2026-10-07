import { storageBufferCap } from '../../residency/pools.ts'
import { CLUSTER_WORDS } from './layout.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import type { DagPartTable } from './shader/bindings.ts'
import { type TableSplit, splitTable, flagSectionStart, flagCuts } from './splitFlags.ts'
import { RESIDENCY_RULE, coalesceRanges } from '../../webgpu/residency/ranges.ts'

/** How a camera cut lays its tables: `flagCuts`, the flag sections each part of
 *  `flags` after the first starts at (`flagSectionStart`). */
export type DagSplit = {
  clusters: TableSplit
  nodes: TableSplit
  cold: TableSplit
  flagCuts: readonly number[]
}

/** Bytes of one element of each table the kernel reads by record: a `Cluster`, a `CullNode`, a
 *  word. */
export const ELEMENT_BYTES = { clusters: CLUSTER_WORDS * 4, nodes: DAG_NODE_FLOATS * 4, cold: 4 }
/** The draw mask's section: what a reader outside the kernel binds. */
export const MASK_SECTION = 1

/** Words of each part of a `flags` of `words` in all, cut at `cuts`. */
export function flagPartWords(
  cuts: readonly number[],
  queueCap: number,
  pageCount: number,
  words: number,
) {
  const starts = [0, ...cuts.map((s) => Math.min(words, flagSectionStart(s, queueCap, pageCount)))]
  return starts.map((start, k) => (starts[k + 1] ?? words) - start)
}

/** The part of a `flags` cut at `cuts` that holds section `section`, and its first word there. */
export function flagLocation(
  cuts: readonly number[],
  section: number,
  queueCap: number,
  pageCount: number,
) {
  const part = cuts.filter((s) => s <= section).length
  const start = part ? flagSectionStart(cuts[part - 1], queueCap, pageCount) : 0
  return { part, word: flagSectionStart(section, queueCap, pageCount) - start }
}

/**
 * The split of a camera cut on this device. The flag sections are cut on queues of the larger of
 * the node count and the primitive count, never smaller than the camera's own.
 */
export function dagSplit(
  limits: Parameters<typeof storageBufferCap>[0],
  packed: { pageCount: number; nodeCount: number; worldCount: number },
  sizes: { clusters: number; nodes: number; cold: number },
): DagSplit {
  const cap = storageBufferCap(limits),
    table = (name: keyof typeof ELEMENT_BYTES) =>
      splitTable(Math.ceil(sizes[name] / ELEMENT_BYTES[name]), ELEMENT_BYTES[name], cap)
  const queueCap = Math.max(packed.nodeCount, Math.max(1, packed.worldCount))
  return {
    clusters: table('clusters'),
    nodes: table('nodes'),
    cold: table('cold'),
    flagCuts: flagCuts(queueCap, packed.pageCount, cap),
  }
}

/** The parts of each table `split` lays out: what the layout and the text bind
 *  (`shader/bindings.ts`, `dagPartBindings`). */
export const dagPartCounts = (split: DagSplit): Record<DagPartTable, number> => ({
  clusters: split.clusters.parts,
  nodes: split.nodes.parts,
  cold: split.cold.parts,
  flags: split.flagCuts.length + 1,
})

/** A table as buffers: the parts, `bytes` in each but the last. */
export type DagParts = { buffers: GPUBuffer[]; bytes: number }

/**
 * Writes `size` bytes of `data` from `dataOffset` at byte `offset` of the table `parts` lays out,
 * each span into the part that holds it: a residency word, a node's open count, the pool's list.
 */
export function writeParts(
  device: GPUDevice,
  parts: DagParts,
  offset: number,
  data: ArrayBuffer,
  dataOffset: number,
  size: number,
) {
  for (let at = offset, end = offset + size; at < end;) {
    const part = Math.floor(at / parts.bytes),
      within = at - part * parts.bytes,
      bytes = Math.min(end - at, parts.bytes - within)
    device.queue.writeBuffer(parts.buffers[part], within, data, dataOffset + at - offset, bytes)
    at += bytes
  }
}

/** Where `writeRanges` sends a run that is not a split table: `size` bytes of `data` from
 *  `dataOffset`, at byte `offset` of the table the target lays out — the cut's worlds and their
 *  exact translations, one buffer per range of placements (`frameRanges.ts`). */
export type RangeTarget = (
  offset: number,
  data: ArrayBuffer,
  dataOffset: number,
  size: number,
) => void

/** What `writeRanges` sends: the source's words, `stride` per index, from word `sourceBase` there
 *  and from word `targetBase` in the table. */
export type RangeSource = {
  data: Float32Array | Uint32Array
  sourceBase: number
  targetBase: number
  stride: number
}

/**
 * The one run writer of the cut's tables: the `count` increasing indices of `sorted` joined into
 * the ranges the residency flush's rule makes (`RESIDENCY_RULE`, `coalesceRanges`), each sent as
 * one write into `parts` — the residency bits and node counts, the placement tree's nodes, the
 * placements' links — or through `parts` when it is a `RangeTarget` — the worlds a call named.
 * `ranges` is a scratch of `RESIDENCY_RULE.cap` pairs.
 */
export function writeRanges(
  device: GPUDevice,
  parts: DagParts | RangeTarget,
  sorted: Int32Array,
  count: number,
  { data, sourceBase, targetBase, stride }: RangeSource,
  ranges: Int32Array,
) {
  const spans = coalesceRanges(sorted, count, ranges, RESIDENCY_RULE)
  for (let r = 0; r < spans; r++) {
    const first = ranges[r * 2],
      bytes = (ranges[r * 2 + 1] - first + 1) * stride * 4,
      offset = (targetBase + first * stride) * 4,
      from = data.byteOffset + (sourceBase + first * stride) * 4
    if (typeof parts === 'function') parts(offset, data.buffer as ArrayBuffer, from, bytes)
    else writeParts(device, parts, offset, data.buffer as ArrayBuffer, from, bytes)
  }
}
