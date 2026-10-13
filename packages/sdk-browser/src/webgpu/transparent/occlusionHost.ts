import { createTransparentOcclusion } from '../../gpu/core/transparentOcclusion.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import {
  createEntryCorners,
  encodeEntryCorners,
  ensureEntryInputs,
  sendEntryInputs,
  targetEntry,
} from './entryCorners.ts'

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
    { table, compaction } = blendState
  const hiz = vis.gpuHiz,
    partition = vis.gpuPartition
  if (!hiz || !partition || !table || !compaction?.encode) return
  blendState.occlusion = await createTransparentOcclusion(device, table.capacity, {
    pyramid: () => hiz.pyramidView(),
    uniforms: partition.uniforms,
    // The compaction's, read at each image: its buffers are made over when the table outgrows them.
    occluded: () => blendState.compaction!.occludedBuffer,
  })
  if (!blendState.occlusion) return
  blendState.occlusionEpoch = -1
}

/**
 * The test made to cover the entries the table gained, and every corner derived again at the next
 * image: the entries joined behind the held ones, and the held ones were never rewritten, so the
 * table's age is the only thing that says they are to be.
 */
export function growTransparentOcclusion(rt: WebgpuPagesRuntime) {
  const { blendState } = rt,
    { table, occlusion } = blendState
  if (!table || !occlusion) return
  occlusion.grow(table.capacity)
  blendState.occlusionEpoch = -1
}

/**
 * The eight world corners of every transparent-table entry, in the buffer the test reads, derived
 * on the GPU from each entry's root's world (`entryCorners.ts`) just before the test, in the frame's
 * command buffer.
 *
 * A transparent cluster claims no visibility-buffer row: its corners therefore do not travel with
 * the row table's dirty range, and it is here they leave. As for opaques, a corner changes only when
 * its page's world matrix changes: a moving camera derives none, and a moving placement its own
 * entries (`occlusionPosed`), never the table. A table of another age, or a corners buffer made
 * anew, sends every entry's inputs and the entries never culled (`neverCulled`), one bit each, and
 * derives every entry; a table of the same age sends again the inputs of the entries whose pages a
 * rewrite bounded elsewhere (`occlusionMoved`): a sea rewritten each frame sends its own, no other.
 */
export function refreshTransparentCorners(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState, layout } = rt,
    { table, occlusion, occlusionMoved: moved, occlusionPosed: posed } = blendState,
    device = rt.gpu.device
  if (!table || !occlusion || !device) return
  const held = (blendState.occlusionEntries ??= createEntryCorners()),
    epoch = layout.rows.tableEpoch,
    last = table.capacity - 1,
    named = posed.take()
  const made = ensureEntryInputs(device, held, table.capacity)
  if (made || blendState.occlusionEpoch !== epoch || held.corners !== occlusion.corners) {
    blendState.occlusionEpoch = epoch
    occlusion.unculledBits.fill(0)
    sendEntryInputs(rt, held, { from: 0, to: last, bits: occlusion.unculledBits })
    occlusion.uploadUnculled()
    held.all = true
  } else {
    const to = Math.min(moved.to, last)
    if (to >= moved.from)
      sendEntryInputs(rt, held, { from: moved.from, to, bits: occlusion.unculledBits })
    for (let entry = moved.from; entry <= to; entry++) targetEntry(held, entry)
    for (let k = 0; k < named.length; k++) if (named[k] <= last) targetEntry(held, named[k])
  }
  moved.from = Infinity
  moved.to = -1
  encodeEntryCorners(rt, device, encoder, {
    held,
    corners: occlusion.corners,
    capacity: table.capacity,
  })
}
