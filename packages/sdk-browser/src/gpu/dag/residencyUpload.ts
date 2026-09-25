import type { ResidencyChanges } from '../core/selection.ts';
import { RESIDENCY_RANGE_MAX, coalesceResidencyRanges } from '../../webgpu/residency/ranges.ts';
import { childBase, residentBase, residentWords } from './layout.ts';
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts';
import { createDagReadiness } from './readiness.ts';

/**
 * One of the cut rule's residency bit sets: one word for thirty-two clusters, which is by itself
 * its own mirror — the comparison rereads the bit it is about to write, with no parallel array.
 * Only pages `changes` names are visited, all of them when it names none reliably.
 * `touched` receives the word ranks touched, increasing and without repetition: those are what
 * the top writes, not the pages. Returns their count.
 */
export function updateResidencyBits(
  next: ArrayLike<number>,
  bits: Uint32Array,
  base: number,
  changes: ResidencyChanges | undefined,
  touched: Int32Array,
) {
  let count = 0,
    last = -1;
  const apply = (j: number) => {
    const word = j >>> 5,
      mask = 1 << (j & 31),
      current = bits[base + word];
    if (((current & mask) !== 0) === !!next[j]) return;
    bits[base + word] = next[j] ? current | mask : current & ~mask;
    if (word === last) return;
    touched[count++] = word;
    last = word;
  };
  if (changes?.sorted) for (let i = 0; i < changes.count; i++) apply(changes.pages[i]);
  else for (let j = 0; j < next.length; j++) apply(j);
  return count;
}

/**
 * The kernel's residency, kept by difference: the pool's per-page residency goes in, the cut
 * rule's two bit sets and the nodes' open counts come out (`readiness.ts`), and only the word and
 * node ranges that changed are written. Returns whether anything did.
 */
export function createDagResidencyUpload(resources: {
  device: GPUDevice;
  packed: PackedDag;
  pageCones: GPUBuffer;
  nodes: GPUBuffer;
}) {
  const { device, packed, pageCones, nodes } = resources,
    pageCount = packed.pageCount;
  const readiness = createDagReadiness(packed);
  // The bits extend the cold records in their buffer: one view, mirror and write source.
  const bits = new Uint32Array(
    packed.pageCones.buffer,
    packed.pageCones.byteOffset,
    packed.pageCones.length,
  );
  /** Words or nodes the last apply changed, and the ranges that cover them. */
  const touched = new Int32Array(Math.max(1, residentWords(pageCount), packed.nodeCount));
  const ranges = new Int32Array(RESIDENCY_RANGE_MAX * 2);
  const changed = { pages: new Int32Array(Math.max(1, pageCount)), count: 0, sorted: true };
  const sets = [
    { values: readiness.ready, base: residentBase(pageCount) },
    { values: readiness.childReady, base: childBase(pageCount) },
  ];
  /** One write per contiguous range of the `count` sorted ranks of `touched`, `stride` words each
   *  from `base`: a thousand small writes are not worth the single one they replace. */
  const upload = (
    target: GPUBuffer,
    source: Float32Array,
    base: number,
    stride: number,
    count: number,
  ) => {
    const spans = coalesceResidencyRanges(touched, count, ranges);
    for (let r = 0; r < spans; r++) {
      const from = (base + ranges[r * 2] * stride) * 4,
        bytes = (ranges[r * 2 + 1] - ranges[r * 2] + 1) * stride * 4;
      device.queue.writeBuffer(
        target,
        from,
        source.buffer as ArrayBuffer,
        source.byteOffset + from,
        bytes,
      );
    }
  };
  return (next: ArrayLike<number>, changes?: ResidencyChanges) => {
    const settled = readiness.apply(next, changes);
    if (!settled.pages.length && !settled.nodes.length) return false;
    changed.pages.set(settled.pages);
    changed.count = settled.pages.length;
    for (const { values, base } of sets)
      upload(
        pageCones,
        packed.pageCones,
        base,
        1,
        updateResidencyBits(values, bits, base, changed, touched),
      );
    touched.set(settled.nodes);
    upload(nodes, packed.nodes, 0, DAG_NODE_FLOATS, settled.nodes.length);
    return true;
  };
}
