import {
  createTransparentOcclusion,
  type OcclusionFrame,
} from '../../gpu/core/transparentOcclusion.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import { visLayerTop } from '../../visibility/passes/uniforms.ts'
import { cullStep } from '../../frame/render/cutFreeze.ts'
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
 * It is neither a fallback nor an option: without a pyramid or without GPU compaction there is
 * simply nothing to strip, and the transparent table then keeps all its entries — the image is the
 * same, at the cost it had. The verdict buffer belongs to compaction and stays zero while nobody
 * writes it.
 */
export async function prepareTransparentOcclusion(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, blendState } = rt,
    { table, compaction } = blendState
  const hiz = vis.gpuHiz
  if (!hiz || !table || !compaction?.encode) return
  blendState.occlusion = await createTransparentOcclusion(device, table.capacity, {
    pyramid: () => hiz.pyramidView(),
    levels: hiz.levelTable,
    // The compaction's, read at each image: its buffers are made over when the table outgrows them.
    occluded: () => blendState.compaction!.occludedBuffer,
  })
  if (!blendState.occlusion) return
  blendState.occlusionEpoch = -1
}

const noMatrix = new Float64Array(16)
/** The test's frame, filled every image in the SAME object: `begin` writes it into the uniform and
 *  copies what the audit keeps, so nothing here needs to be new. The anchor is a tuple held the same
 *  way, so the camera pose allocates nothing. */
const anchor: [number, number, number] = [0, 0, 0]
const frame: OcclusionFrame = {
  view: noMatrix,
  viewProj: noMatrix,
  anchor,
  near: 0,
  width: 0,
  height: 0,
  layerTop: 0,
  cull: 'follow',
}

/**
 * The frame the transparent clusters are tested under, at the head of the visibility image
 * (`../../frame/render/encodeVis.ts`): the matrices come from the ENGINE camera, which image entry
 * has already filled from the pose contract (`../../camera/world.ts`), view and view-projection
 * posted there once for the whole image in double precision; the test adds no matrix calculation.
 */
export function beginTransparentOcclusion(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const occlusion = rt.blendState.occlusion
  if (!occlusion) return
  frame.view = cam.view
  // The render matrix, temporal-antialiasing jitter included: the pyramid the test reads was
  // rasterised with it, and its margins are to the ulp.
  frame.viewProj = taaRenderMatrix(rt, cam)
  // Projection anchor: the eye in the world. Corners enter the kernel only by their offset from it,
  // which keeps the error bound tight whatever the model size.
  anchor[0] = cam.eye[0]
  anchor[1] = cam.eye[1]
  anchor[2] = cam.eye[2]
  frame.near = cam.near
  frame.width = rt.gpu.targetSize[0]
  frame.height = rt.gpu.targetSize[1]
  frame.layerTop = visLayerTop(rt.vis)
  // The image's cull: a frozen cut's draws again the verdicts it kept
  // (`../../frame/render/cutFreeze.ts`).
  frame.cull = cullStep(rt)
  occlusion.begin(frame)
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
    held.corners = occlusion.corners
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
  encodeEntryCorners(rt, device, encoder, { held, capacity: table.capacity })
}
