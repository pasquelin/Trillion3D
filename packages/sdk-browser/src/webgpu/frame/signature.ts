import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** Number of values in the frame signature; see `sampleWebgpuFrame`. */
export const HOLD_SIGNATURE_VALUES = 14

/**
 * What decides the pixels of a frame, in fourteen numbers: the row table, the cut — its pages, its
 * triangles, its level — and the transparent draws it feeds.
 *
 * Two consecutive frames whose three revisions and these numbers match draw the same image: same
 * rows, same cut, same transparent geometry. That covers states that converge without being
 * written — a cut read back a few frames late — without having to keep a list of them.
 *
 * The culling verdicts are left out: the frustum and occlusion tests, opaque and transparent,
 * are conservative — a verdict only drops what has no pixel, or moves a row between the two
 * draw passes — and under the antialiasing jitter they wander from one phase to the next with
 * the image unchanged. Counting them would call a still image moved and restart its average.
 */
export function sampleWebgpuFrame(rt: WebgpuPagesRuntime, into: Float64Array) {
  const { run } = rt,
    { rows } = rt.layout
  into[0] = rows.tableEpoch
  into[1] = rows.rowsEpoch
  into[2] = rows.packedCount
  into[3] = rows.rowCount
  into[4] = run.cutEpoch
  into[5] = run.pageArrayEpoch
  into[6] = run.visible
  into[7] = run.selectedTriangles
  into[8] = run.submittedTriangles
  into[9] = run.frustumRejected
  into[10] = run.lodLevel
  into[11] = run.gpuDrawCalls
  into[12] = run.blendDrawCalls
  into[13] = run.blendSubmittedTriangles
}
