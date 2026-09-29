import { storageBufferCap } from '../../residency/pools.ts';
import { CLUSTER_WORDS } from './layout.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { DAG_NODE_FLOATS } from './types.ts';
import type { DagPartTable } from './shader/bindings.ts';

/**
 * A CUT'S TABLES IN PARTS, past one storage binding of the device. `frames` and `worlds` split in
 * ranges of primitives, one dispatch each (`frameRanges.ts`); the tables a thread reads at any
 * index — a page's record, a queue's node, a key's canonical page, whose last use a range may stamp
 * in another's — cannot: they split in parts that every dispatch binds at once, each its own buffer
 * of at most one binding, and the kernel reads them through one accessor per table
 * (`shader/splitWgsl.ts`). A table the device holds whole is one part: the layout, the text and the
 * bindings of before. A device that cannot bind the parts at once refuses the GPU cut, and the CPU
 * cut draws (`deviceRefusal.ts`): coarser in time, never a hole.
 */

/** A table cut in parts of `per` elements each, the last holding what remains. */
export type TableSplit = { per: number; parts: number };
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

/** `count` elements of `bytes` each in parts one binding of `cap` bytes holds; one element past
 *  the binding stays one part per element, which the fit rule then refuses (`pastBinding`). */
export function splitTable(count: number, bytes: number, cap: number): TableSplit {
  const per = Math.max(1, Math.floor(cap / bytes));
  if (count <= per) return { per: Math.max(1, count), parts: 1 };
  return { per, parts: Math.ceil(count / per) };
}

/** Flag sections behind queue 0: the draw mask, the cone words, the live list, the candidate list
 *  (a light cut's drawn log), each one word per page (`shader/levelWgsl.ts`). */
export const PAGE_SECTIONS = 4;
/** Sections of a camera cut's `flags`: queue 0, the four page sections, the other queues, then
 *  each page's last use (`shader/lastUseWgsl.ts`); a light cut has all but the last. */
export const FLAG_SECTIONS = 1 + PAGE_SECTIONS + (LEVEL_QUEUES - 1) + 1;
/** The draw mask's section, and the candidate list's behind the cone words and the live list:
 *  what a reader outside the kernel binds. */
export const MASK_SECTION = 1,
  CANDIDATE_SECTION = MASK_SECTION + 3;

/** First word of section `s` of a `flags` of `queueCap` per queue over `pageCount` pages: the
 *  kernel's `queueBase` and page bases, as `shader/splitWgsl.ts` states them in WGSL. */
export function flagSectionStart(s: number, queueCap: number, pageCount: number) {
  if (s === 0) return 0;
  if (s <= PAGE_SECTIONS) return queueCap + (s - 1) * pageCount;
  return (s - PAGE_SECTIONS) * queueCap + PAGE_SECTIONS * pageCount;
}

/** Words of section `s`: a queue's `queueCap`, or one per page. */
const sectionWords = (s: number, queueCap: number, pageCount: number) =>
  (s >= 1 && s <= PAGE_SECTIONS) || s === FLAG_SECTIONS - 1 ? pageCount : queueCap;

/** The sections a `flags` of `queueCap` per queue over `pageCount` pages starts parts at, first
 *  fit: each part as many whole sections as one binding of `cap` bytes holds. A section is never
 *  cut, so the draw mask and the drawn log each lie in one part; one past the binding is a part of
 *  its own, which the fit rule refuses. */
export function flagCuts(queueCap: number, pageCount: number, cap: number) {
  const cuts: number[] = [];
  let words = sectionWords(0, queueCap, pageCount);
  for (let s = 1; s < FLAG_SECTIONS; s++) {
    const own = sectionWords(s, queueCap, pageCount);
    if ((words + own) * 4 > cap) {
      cuts.push(s);
      words = own;
    } else words += own;
  }
  return cuts;
}

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
