import { frustumExcludesBox } from '../../../../sdk-core/src/index.ts';
import { rootOf, type PageRec } from '../../page/selection/selection.ts';
import type { Placements } from '../../page/selection/types.ts';
import { notDrawn } from '../../placement/hidden.ts';
import type { createWebgpuBlendState } from './state.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * Transparent draw list of the FALLBACK PATH, the one for devices without a visibility buffer.
 *
 * The production path holds no draw list: the frustum is tested there with the sort keys, and
 * the GPU expands the sorted plan into instances (`order.ts`). Here the frustum
 * rejects whole primitives, the CPU cut (its records, and the roots that place them) omits items
 * with no selected cluster, a hidden node or a parked row omits its item, and source order is
 * preserved.
 */
export function selectWebgpuBlend(
  blendState: BlendState,
  cut?: { drawn: readonly PageRec[]; roots: Placements },
) {
  const selected = blendState.cpuSelectedPlacements,
    drawn = cut?.drawn;
  selected.clear();
  blendState.visibleBlend.length = 0;
  if (cut) for (const rec of cut.drawn) if (rec.transparent) selected.add(rootOf(cut.roots, rec).world);
  let rejected = 0;
  for (const item of blendState.blendGpu) {
    if (notDrawn(item)) continue;
    if (drawn && item.paged && !selected.has(item.matrix)) continue;
    const box = item.bounds;
    if (
      box &&
      frustumExcludesBox(blendState.blendPlanes, box[0], box[1], box[2], box[3], box[4], box[5])
    )
      rejected++;
    else blendState.visibleBlend.push(item);
  }
  return rejected;
}

/**
 * The instance lists of a CPU-cut image, written where the GPU compaction would have written them.
 *
 * The cut names records; the table names the order. Walking the cut once and placing each record at
 * its item's base, then sorting each item's own range by table entry, gives the same list the
 * compaction produces — the table order with the unselected entries removed — so the two paths draw
 * the same primitives in the same order and the shader cannot tell them apart.
 */
export function writeCpuTransparentInstances(
  blendState: BlendState,
  drawn: readonly PageRec[],
  entryOf: (rec: PageRec) => number,
) {
  const { table } = blendState;
  if (!table) return;
  if (blendState.cpuInstances.length < table.capacity)
    blendState.cpuInstances = new Uint32Array(table.capacity);
  if (blendState.cpuItemCounts.length < table.pagedItems.length)
    blendState.cpuItemCounts = new Uint32Array(Math.max(1, table.pagedItems.length));
  const instances = blendState.cpuInstances,
    counts = blendState.cpuItemCounts;
  counts.fill(0);
  let highest = 0;
  for (let i = 0; i < drawn.length; i++) {
    const rec = drawn[i];
    if (!rec.transparent) continue;
    const entry = entryOf(rec);
    if (entry < 0) continue;
    // The entry names its item: no search by placement per record.
    const index = table.itemOfEntry[entry],
      base = table.itemRanges[index * 2];
    instances[base + counts[index]++] = entry;
    if (base + counts[index] > highest) highest = base + counts[index];
  }
  for (const item of table.pagedItems) {
    const index = item.pagedIndex!,
      base = table.itemRanges[index * 2],
      count = counts[index];
    // The list almost always arrives already increasing — the reread publishes its pages in
    // catalogue order, and table entries are stored by source rank. One walk checks that, where
    // an unconditional sort sorted per primitive and per frame.
    let ordonnee = true;
    for (let k = base + 1; k < base + count; k++)
      if (instances[k - 1] > instances[k]) {
        ordonnee = false;
        break;
      }
    if (!ordonnee) instances.subarray(base, base + count).sort();
  }
  blendState.cpuInstanceCount = highest;
}
