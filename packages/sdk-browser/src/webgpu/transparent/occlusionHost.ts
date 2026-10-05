import { CORNER_VALUES } from '../../gpu/partition/contract.ts';
import { createTransparentOcclusion } from '../../gpu/core/transparentOcclusion.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { packPageCorners } from '../visibility/corners.ts';
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts';
import { rootOf } from '../../page/selection/placements.ts';

type Table = NonNullable<WebgpuPagesRuntime['blendState']['table']>;

/**
 * Mounts the occlusion test of transparent clusters, once everything it borrows exists.
 *
 * It is neither a fallback nor an option: without a pyramid, without a partition or without GPU
 * compaction there is simply nothing to strip, and the transparent table then keeps all its entries
 * — the image is the same, at the cost it had. The verdict buffer belongs to compaction and stays
 * zero while nobody writes it.
 */
export async function prepareTransparentOcclusion(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, blendState } = rt,
    { table, compaction } = blendState;
  const hiz = vis.gpuHiz,
    partition = vis.gpuPartition;
  if (!hiz || !partition || !table || !compaction?.encode || !table.length) return;
  blendState.occlusion = await createTransparentOcclusion(device, table.capacity, {
    pyramid: () => hiz.pyramidBuffer(),
    uniforms: partition.uniforms,
    occluded: compaction.occludedBuffer,
  });
  if (!blendState.occlusion) return;
  blendState.occlusionCorners = new Float32Array(table.capacity * CORNER_VALUES);
  blendState.occlusionEpoch = -1;
}

/**
 * The eight world corners of every transparent-table entry, in the buffer the test reads.
 *
 * A transparent cluster claims no visibility-buffer row: its corners therefore do not travel with
 * the row table's dirty range, and it is here they leave. As for opaques, a corner changes only when
 * its page's world matrix changes, and the table's age names exactly that moment: a moving camera
 * rewrites none. The doubles are those of `pageCornersInto`, each carried by two single-precision
 * values — the rounding and its residue. The entries never culled (`neverCulled`) leave with them,
 * one bit each. A table of the same age sends again only the entries whose pages a rewrite bounded
 * elsewhere (`occlusionMoved`, #573): a sea rewritten each frame sends its own, no other.
 */
export function refreshTransparentCorners(rt: WebgpuPagesRuntime) {
  const { blendState, layout } = rt,
    { table, occlusion, occlusionMoved: moved } = blendState;
  if (!table || !occlusion) return;
  const epoch = layout.rows.tableEpoch,
    last = table.capacity - 1;
  if (blendState.occlusionEpoch === epoch) {
    const to = Math.min(moved.to, last);
    if (to >= moved.from) {
      packEntries(rt, table, moved.from, to);
      occlusion.uploadCorners(blendState.occlusionCorners, moved.from, to);
    }
  } else {
    blendState.occlusionEpoch = epoch;
    occlusion.unculledBits.fill(0);
    packEntries(rt, table, 0, last);
    occlusion.uploadCorners(blendState.occlusionCorners, 0, last);
    occlusion.uploadUnculled();
  }
  moved.from = Infinity;
  moved.to = -1;
}

/** Packs the corners of `table`'s entries `from` to `to`, and sets the bit of each one never
 *  culled. */
function packEntries(rt: WebgpuPagesRuntime, table: Table, from: number, to: number) {
  const { blendState, layout } = rt,
    packed = blendState.occlusionCorners,
    { recordOf, selectionRoots, placement } = layout,
    bits = blendState.occlusion!.unculledBits;
  for (let entry = from; entry <= to; entry++) {
    const base = entry * CORNER_VALUES,
      page = table.pageOfEntry[entry];
    // An alignment entry names no page: its corners stay zero, and compaction drops it even before
    // reading its verdict.
    if (page < 0) {
      packed.fill(0, base, base + CORNER_VALUES);
      continue;
    }
    const rec = recordOf(page);
    // A rank the catalogue does not hold names no record: its corners stay zero, as an alignment
    // entry's, so no stale rectangle survives from a previous table.
    if (!rec) {
      packed.fill(0, base, base + CORNER_VALUES);
      continue;
    }
    const root = rootOf(selectionRoots, placement.rootOfPacked[page]);
    packPageCorners(packed, base, rec, root.world, root.reach);
    if (neverCulled(rec.material)) bits[entry >> 5] |= 1 << (entry & 31);
  }
}
