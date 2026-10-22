import { feedbackAttachment } from '../frame/prepare/attachments.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import type { ShareTargets } from './blendTargets.ts'
import type { AsIsShare } from '../lighting/deferred/asIsShare.ts'
import type { BlendRuns } from './draw.ts'
import type { DisplayFilter } from './display/displayFilter.ts'

// THE BLEND PASS'S ATTACHMENTS (`drawBlendPass`, `drawCompanion`), module-level objects refilled each
// image, so that no image allocates one.

/** The colour attachments of the blend pass under the dual blend: the HDR target alone, as WebGPU
 *  takes a dual blend (`drawBlendPass`). One array, refilled each image. */
export const dualColour: GPURenderPassColorAttachment[] = [
  { view: undefined as unknown as GPUTextureView, loadOp: 'load', storeOp: 'store' },
]

/** A colour attachment the blend pass loads and stores, its view set each image. */
const loaded = (): GPURenderPassColorAttachment => ({
  view: undefined as unknown as GPUTextureView,
  loadOp: 'load',
  storeOp: 'store',
})
const hdrColour = loaded()
export const shareColour = loaded(),
  givenUpColour = loaded()
/** The colour attachments of the blend pass on every target (`drawBlendPass`): the HDR target, the
 *  virtual-texture feedback, the share, the two display layers and the history given up beside the
 *  share, each slot empty while unused. One array, refilled each image. */
const allColour: Array<GPURenderPassColorAttachment | null> = [
  hdrColour,
  null,
  null,
  null,
  null,
  null,
]
/** The depth the blend pass tests against, read only: its view set each image. */
export const blendDepth: GPURenderPassDepthStencilAttachment = {
  view: undefined as unknown as GPUTextureView,
  depthReadOnly: true,
}
/** What a frame asks the programs to reach, and what its one pass on every target holds: one
 *  object each, refilled each image. */
export const reached: { share: ShareTargets; filtered: boolean } = { share: 0, filtered: false }
export const allRuns: BlendRuns = {}
/** The companion pass's colour attachments (`drawCompanion`): no colour, the feedback, the share,
 *  the history given up; its runs' options. Refilled each image. */
export const companionColour: Array<GPURenderPassColorAttachment | null> = [null, null, null, null]
export const companionRuns: BlendRuns = {}

/** Fills `allColour` for an image: the feedback while the pipelines write it, the share a debug
 *  view or the temporal pass reads and the history given up beside it at `targets` 2, the display
 *  layers of an image whose blends filter. */
export function fillAllColour(
  rt: WebgpuPagesRuntime,
  share: AsIsShare | undefined,
  targets: ShareTargets,
  filter: DisplayFilter | undefined,
) {
  hdrColour.view = rt.gpu.hdrView!
  // Virtual-texture feedback, opened by the first pass that writes it, while the pipelines do.
  allColour[1] = rt.vis.writesFeedback ? feedbackAttachment(rt) : null
  allColour[2] = attached(shareColour, share?.view)
  // The display layers (`display/displayFilter.ts`): the tint and the added value.
  const layers = filter?.attachments()
  allColour[3] = layers?.[0] ?? null
  allColour[4] = layers?.[1] ?? null
  allColour[5] = attached(givenUpColour, targets === 2 ? share?.givenUpView : undefined)
  return allColour
}

/** `colour` on `view`, or an empty slot without one. */
export function attached(colour: GPURenderPassColorAttachment, view: GPUTextureView | undefined) {
  if (!view) return null
  colour.view = view
  return colour
}
