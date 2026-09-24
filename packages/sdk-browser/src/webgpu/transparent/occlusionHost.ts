import { CORNER_VALUES } from '../../gpu/partition/contract.ts';
import { createTransparentOcclusion } from '../../gpu/core/transparentOcclusion.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { packBoxCorners } from '../visibility/corners.ts';
import { BOX_CORNER_VALUES, pageCornersInto } from '../../hiz/hiz.ts';

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

const entryCorners = new Float64Array(BOX_CORNER_VALUES);

/**
 * The eight world corners of every transparent-table entry, in the buffer the test reads.
 *
 * A transparent cluster claims no visibility-buffer row: its corners therefore do not travel with
 * the row table's dirty range, and it is here they leave. As for opaques, a corner changes only when
 * its page's world matrix changes, and the table's age names exactly that moment: a moving camera
 * rewrites none. The doubles are those of `pageCornersInto`, each carried by two single-precision
 * values — the rounding and its residue.
 */
export function refreshTransparentCorners(rt: WebgpuPagesRuntime) {
  const { blendState, layout } = rt,
    { table, occlusion } = blendState;
  if (!table || !occlusion) return;
  const epoch = layout.rows.tableEpoch;
  if (blendState.occlusionEpoch === epoch) return;
  blendState.occlusionEpoch = epoch;
  const packed = blendState.occlusionCorners,
    { packedPages } = layout;
  for (let entry = 0; entry < table.capacity; entry++) {
    const base = entry * CORNER_VALUES,
      page = table.pageOfEntry[entry];
    // An alignment entry names no page: its corners stay zero, and compaction drops it even before
    // reading its verdict.
    if (page < 0) {
      packed.fill(0, base, base + CORNER_VALUES);
      continue;
    }
    pageCornersInto(entryCorners, 0, packedPages[page]);
    packBoxCorners(packed, base, entryCorners, 0);
  }
  occlusion.uploadCorners(packed, 0, table.capacity - 1);
}
