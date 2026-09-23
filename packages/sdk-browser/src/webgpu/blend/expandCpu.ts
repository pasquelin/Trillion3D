import { DRAW_UNPAGED, planItem } from './plan.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from './runs.ts';
import type { createWebgpuBlendState } from './state.ts';

/**
 * Everything plan expansion reads and writes, without a single GPU object: that is the reference
 * SEMANTICS of the `expandWgsl.ts` kernel, and it is also the path a device without a
 * compute stage takes, as-is.
 */
export type BlendExpansion = {
  /** Sorted plan, farthest to nearest, and the runs that slice it. */
  order: Uint32Array;
  runs: Uint32Array;
  runCount: number;
  /** Four words per item: paged rank, static instances, table base, vertices per instance. */
  draws: Uint32Array;
  /** One bit per item: zero for the item the frustum rejects, which expands no instance. */
  keep: Uint32Array;
  /** Instances compaction kept per paged item, and its entry list. */
  itemCounts: Uint32Array;
  instances: Uint32Array;
  /** Vertices of a paged cluster, and the instance addressing stride. */
  maxVertexWords: number;
  vertexShift: number;
  /** Where the pass expands its instances, and where it writes its arguments: two regions per pass. */
  instanceBase: number;
  argsBase: number;
  /** Outputs: two words per instance, four indirect-argument words per run. */
  expanded: Uint32Array;
  args: Uint32Array;
};

/** Did the frustum keep this item? One bit per item, written by the frame's ranking. */
export const itemKept = (keep: Uint32Array, item: number) =>
  (keep[item >>> 5] & (1 << (item & 31))) !== 0;

/**
 * Expands the sorted plan into an instance list and one indirect argument per run.
 *
 * An instance says two things: the item that carries it, and what it draws — the table entry of
 * a paged cluster, the first index of its chunk for a primitive that is not. The list follows
 * plan order, hence paint order, and a run's draw starts at vertex `base << vertexShift` so the
 * shader finds the rank of its first instance there.
 *
 * Returns the number of instances written.
 */
export function expandBlendPlan(x: BlendExpansion) {
  const { order, runs, draws, keep, itemCounts, instances, expanded, args } = x;
  let cursor = x.instanceBase;
  for (let run = 0; run < x.runCount; run++) {
    const at = run * RUN_WORDS,
      first = runs[at],
      entries = runs[at + 1],
      owner = runOwner(order[first], entries),
      base = cursor;
    // A shared run draws clusters, all at the table stride; a run of a single unpaged item draws
    // its chunks, at the stride its geometry gave it.
    const vertexCount =
      owner !== RUN_SHARED && draws[owner * 4] === DRAW_UNPAGED
        ? draws[owner * 4 + 3]
        : x.maxVertexWords;
    for (let k = 0; k < entries; k++) {
      const item = planItem(order[first + k]);
      if (!itemKept(keep, item)) continue;
      const paged = draws[item * 4];
      if (paged === DRAW_UNPAGED) {
        const words = draws[item * 4 + 3],
          morceaux = draws[item * 4 + 1];
        for (let j = 0; j < morceaux; j++) {
          expanded[cursor * 2] = item;
          expanded[cursor * 2 + 1] = j * words;
          cursor++;
        }
        continue;
      }
      const tableBase = draws[item * 4 + 2],
        tenues = itemCounts[paged];
      for (let j = 0; j < tenues; j++) {
        expanded[cursor * 2] = item;
        expanded[cursor * 2 + 1] = instances[tableBase + j];
        cursor++;
      }
    }
    const out = x.argsBase + run * 4;
    args[out] = vertexCount;
    args[out + 1] = cursor - base;
    args[out + 2] = base << x.vertexShift;
    args[out + 3] = 0;
  }
  return cursor - x.instanceBase;
}

/**
 * Fallback of a device without a compute stage: the SAME semantics, written by the CPU.
 *
 * The CPU cut has already filled the instance list and the per-item counts
 * (`selection.ts`); all that remains is to expand both passes' plans and push the two
 * written regions. An item the frustum rejects writes nothing there, exactly as on the GPU.
 */
export function writeBlendExpansionCpu(
  blendState: ReturnType<typeof createWebgpuBlendState>,
  device: GPUDevice,
) {
  const { expandedBuffer, argsBuffer } = blendState;
  if (!expandedBuffer || !argsBuffer) return;
  // The two CPU mirrors exist ONLY on this path: a device with a compute stage does not keep in
  // host memory an instance list the GPU writes on its own.
  if (blendState.expandedPacked.length < blendState.instanceCapacity * 2)
    blendState.expandedPacked = new Uint32Array(blendState.instanceCapacity * 2);
  if (blendState.argsPacked.length < blendState.maxPlanEntries * 8)
    blendState.argsPacked = new Uint32Array(blendState.maxPlanEntries * 8);
  const { expandedPacked, argsPacked } = blendState;
  const orders = blendState.orders,
    bases = blendState.instanceBase;
  for (let pass = 0; pass < orders.length; pass++) {
    const written = expandBlendPlan({
      order: orders[pass],
      runs: blendState.runs[pass],
      runCount: blendState.runCount[pass],
      draws: blendState.drawsPacked,
      keep: blendState.keepPacked,
      itemCounts: blendState.cpuItemCounts,
      instances: blendState.cpuInstances,
      maxVertexWords: blendState.maxVertexWords,
      vertexShift: blendState.vertexShift,
      instanceBase: bases[pass],
      argsBase: blendState.planRegions[pass].args,
      expanded: expandedPacked,
      args: argsPacked,
    });
    const args = blendState.planRegions[pass].args;
    if (written)
      device.queue.writeBuffer(
        expandedBuffer,
        bases[pass] * 8,
        expandedPacked.buffer,
        bases[pass] * 8,
        written * 8,
      );
    // Only THIS frame's runs are pushed: a few dozen bytes, where an argument per item rewrote
    // four per item and per frame.
    if (blendState.runCount[pass])
      device.queue.writeBuffer(
        argsBuffer,
        args * 4,
        argsPacked.buffer,
        args * 4,
        blendState.runCount[pass] * 16,
      );
  }
}
