import { storageBufferCap } from '../../residency/pools.ts';
import { CLUSTER_WORDS } from './layout.ts';
import { DAG_NODE_FLOATS } from './types.ts';
import type { DagPartTable } from './shader/bindings.ts';
import { type TableSplit, splitTable, flagSectionStart, flagCuts } from './splitFlags.ts';

/** How a camera cut and its light cut lay their tables: `flagCuts`, the flag sections each part of
 *  `flags` after the first starts at (`flagSectionStart`). */
export type DagSplit = {
  clusters: TableSplit;
  nodes: TableSplit;
  cold: TableSplit;
  flagCuts: readonly number[];
};

/** Bytes of one element of each table the kernel reads by record: a `Cluster`, a `CullNode`, a
 *  word. */
export const ELEMENT_BYTES = { clusters: CLUSTER_WORDS * 4, nodes: DAG_NODE_FLOATS * 4, cold: 4 };
/** The draw mask's section, and the candidate list's behind the cone words and the live list:
 *  what a reader outside the kernel binds. */
export const MASK_SECTION = 1,
  CANDIDATE_SECTION = MASK_SECTION + 3;

/** Words of each part of a `flags` of `words` in all, cut at `cuts`. */
export function flagPartWords(
  cuts: readonly number[],
  queueCap: number,
  pageCount: number,
  words: number,
) {
  const starts = [0, ...cuts.map((s) => Math.min(words, flagSectionStart(s, queueCap, pageCount)))];
  return starts.map((start, k) => (starts[k + 1] ?? words) - start);
}

/** The part of a `flags` cut at `cuts` that holds section `section`, and its first word there. */
export function flagLocation(
  cuts: readonly number[],
  section: number,
  queueCap: number,
  pageCount: number,
) {
  const part = cuts.filter((s) => s <= section).length;
  const start = part ? flagSectionStart(cuts[part - 1], queueCap, pageCount) : 0;
  return { part, word: flagSectionStart(section, queueCap, pageCount) - start };
}

/**
 * The split of a camera cut on this device. The flag sections are cut on the larger of the
 * camera's queues and a one-view light cut's, so both cuts share one text and one layout; a light
 * cut of more views fits them, or runs fewer (`lightCutCapacity.ts`).
 */
export function dagSplit(
  limits: Parameters<typeof storageBufferCap>[0],
  packed: { pageCount: number; nodeCount: number; worldCount: number },
  sizes: { clusters: number; nodes: number; cold: number },
): DagSplit {
  const cap = storageBufferCap(limits),
    table = (name: keyof typeof ELEMENT_BYTES) =>
      splitTable(Math.ceil(sizes[name] / ELEMENT_BYTES[name]), ELEMENT_BYTES[name], cap);
  const queueCap = Math.max(packed.nodeCount, Math.max(1, packed.worldCount));
  return {
    clusters: table('clusters'),
    nodes: table('nodes'),
    cold: table('cold'),
    flagCuts: flagCuts(queueCap, packed.pageCount, cap),
  };
}

/** The parts of each table `split` lays out: what the layout and the text bind
 *  (`shader/bindings.ts`, `dagPartBindings`). */
export const dagPartCounts = (split: DagSplit): Record<DagPartTable, number> => ({
  clusters: split.clusters.parts,
  nodes: split.nodes.parts,
  cold: split.cold.parts,
  flags: split.flagCuts.length + 1,
});

/** A table as buffers: the parts, `bytes` in each but the last. */
export type DagParts = { buffers: GPUBuffer[]; bytes: number };

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
      bytes = Math.min(end - at, parts.bytes - within);
    device.queue.writeBuffer(parts.buffers[part], within, data, dataOffset + at - offset, bytes);
    at += bytes;
  }
}
