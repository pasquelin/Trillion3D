import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** Number of values in the frame signature; see `sampleWebgpuFrame`. */
export const HOLD_SIGNATURE_VALUES = 14

/** Where the counters a held frame rewrites (`recordHeldFrameWork`) stand in the signature. */
export const SIGNATURE_SLOT = {
  submittedTriangles: 8,
  gpuDrawCalls: 11,
  blendDrawCalls: 12,
  blendSubmittedTriangles: 13,
} as const

/**
 * What decides the pixels of a frame, in fourteen numbers: the clusters' records, the cut — its pages,
 * its triangles, its level — and the transparent draws it feeds.
 *
 * Two consecutive frames whose three revisions and these numbers match draw the same image: same
 * clusters, same cut, same transparent geometry. That covers states that converge without being
 * written — a cut read back a few frames late — without having to keep a list of them.
 *
 * The culling verdicts are left out: the frustum and occlusion tests, opaque and transparent,
 * are conservative — a verdict only drops what has no pixel, or moves a cluster between the two
 * draw passes — and under the antialiasing jitter they wander from one phase to the next with
 * the image unchanged. Counting them would call a still image moved and restart its average.
 */
export function sampleWebgpuFrame(rt: WebgpuPagesRuntime, into: Float64Array) {
  const { run, layout } = rt,
    { clusters } = layout
  into[0] = clusters.infoEpoch
  into[1] = clusters.touchRevision()
  into[2] = layout.packedPages.length
  into[3] = run.gpuSelection?.visibleCap ?? 0
  into[4] = run.cutEpoch
  into[5] = run.pageArrayEpoch
  into[6] = run.visible
  into[7] = run.selectedTriangles
  into[SIGNATURE_SLOT.submittedTriangles] = run.submittedTriangles
  into[9] = run.frustumRejected
  into[10] = run.lodLevel
  into[SIGNATURE_SLOT.gpuDrawCalls] = run.gpuDrawCalls
  into[SIGNATURE_SLOT.blendDrawCalls] = run.blendDrawCalls
  into[SIGNATURE_SLOT.blendSubmittedTriangles] = run.blendSubmittedTriangles
}
