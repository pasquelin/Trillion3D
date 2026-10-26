import { feedbackAttachment } from '../frame/prepare/attachments.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import type { BlendRuns } from './draw.ts'
import type { DisplayFilter } from './display/displayFilter.ts'
import {
  MODULATION_CLEAR,
  MODULATION_KEEPS_ALPHA,
  TRANSLUCENCY_CLEAR,
  markDrawn,
} from './translucency.ts'
import { TRANSPARENTS_PASS } from '../diagnostic/stage/passLabels.ts'
import { holdoutPassOn } from '../frame/prepare/alphaHoldout.ts'

// THE BLEND PASS'S ATTACHMENTS (`drawBlendPass`), module-level objects refilled each
// image, so that no image allocates one.

/** A colour attachment the blend pass clears to `clear` and stores, its view set each image. */
const cleared = (clear: GPUColor): GPURenderPassColorAttachment => ({
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  clearValue: clear,
  storeOp: 'store',
})
/** The translucency target and the modulation target (`translucency.ts`), each cleared by the first
 *  pass that draws into it. */
const translucencyColour = cleared(TRANSLUCENCY_CLEAR),
  modulationColour = cleared(MODULATION_CLEAR)
/** The colour attachments of the blend passes that hold one target alone — under the dual blend, as
 *  WebGPU takes it, the translucency target; the modulation pass of a plan with no layer to draw in
 *  it (`drawBlendPass`). One array each, refilled each image (`dualAttachments`,
 *  `modulationAttachments`). */
const dualColour: GPURenderPassColorAttachment[] = [translucencyColour]
const modulationOnly: GPURenderPassColorAttachment[] = [modulationColour]
const modulationMarked: GPURenderPassColorAttachment[] = [modulationColour, modulationColour]

/** A colour attachment the blend pass loads and stores, its view set each image. */
const loaded = (): GPURenderPassColorAttachment => ({
  view: undefined as unknown as GPUTextureView,
  loadOp: 'load',
  storeOp: 'store',
})
/** The alpha holdout's target (`drawHoldout`), loaded after its start. */
export const holdoutColour = loaded()
/** The responsiveness the responsiveness pass lays its marks in (`drawResponsive`), loaded. */
export const responsiveColour = loaded()
/** The colour attachments of the blend pass on every target (`drawBlendPass`): the translucency
 *  target — the modulation target for the pass of the modes that multiply the scene —, the
 *  virtual-texture feedback and the two display layers, each slot empty while unused. One array,
 *  refilled each image. */
const allColour: Array<GPURenderPassColorAttachment | null> = [translucencyColour, null, null, null]
/** The depth the blend pass tests against, read only: its view set each image. */
export const blendDepth: GPURenderPassDepthStencilAttachment = {
  view: undefined as unknown as GPUTextureView,
  depthReadOnly: true,
}
export const allRuns: BlendRuns = {}
/** Fills `allColour` for an image: the target `first` draws into — the translucency target, or the
 *  modulation target of the pass that multiplies the scene (`translucencyAttachment`,
 *  `modulationAttachment`) —, the feedback while the pipelines write it and the display layers of
 *  an image whose blends filter. */
export function fillAllColour(
  rt: WebgpuPagesRuntime,
  filter: DisplayFilter | undefined,
  first: GPURenderPassColorAttachment,
) {
  allColour[0] = first
  // Virtual-texture feedback, opened by the first pass that writes it, while the pipelines do.
  allColour[1] = rt.vis.writesFeedback ? feedbackAttachment(rt) : null
  // The display layers (`display/displayFilter.ts`): the tint and the added value.
  const layers = filter?.attachments()
  allColour[2] = layers?.[0] ?? null
  allColour[3] = layers?.[1] ?? null
  return allColour
}

/** The attachment of the translucency target, its view set. */
export function translucencyAttachment(rt: WebgpuPagesRuntime) {
  translucencyColour.view = rt.gpu.translucency!.colorView
  return translucencyColour
}

/** The attachment of the modulation target, its view set, cleared to keep the image's alpha
 *  (`MODULATION_KEEPS_ALPHA`) where the alpha holdout lays it itself (`holdoutPassOn`). */
export function modulationAttachment(rt: WebgpuPagesRuntime) {
  modulationColour.clearValue = holdoutPassOn(rt) ? MODULATION_KEEPS_ALPHA : MODULATION_CLEAR
  modulationColour.view = rt.gpu.translucency!.modulationView
  return modulationColour
}

/** The attachments of the pass that draws the translucency target alone (the dual blend's). */
export function dualAttachments(rt: WebgpuPagesRuntime) {
  translucencyAttachment(rt)
  return dualColour
}

/** The attachments of the pass that draws the modulation target, with the feedback beside it where
 *  the pipelines write it. */
export function modulationAttachments(rt: WebgpuPagesRuntime, feedback: boolean) {
  modulationAttachment(rt)
  if (!feedback) return modulationOnly
  modulationMarked[1] = feedbackAttachment(rt)
  return modulationMarked
}

/** The clearing pass that opens a target, held: its one attachment rewritten in place. */
const openTargets: GPURenderPassColorAttachment[] = []
const OPEN: GPURenderPassDescriptor = { label: TRANSPARENTS_PASS, colorAttachments: openTargets }

/** The translucency target, which the layers drawn without a blend pass of this image (the particles)
 *  draw into: a pass that clears it opens them where no pass of the blends did; nothing modulates
 *  the scene then (`TranslucencyTargets.modulated`). None while the targets are not made for the
 *  scene. */
export function openTranslucency(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const targets = rt.gpu.translucency
  if (!targets?.active) return undefined
  if (targets.phase !== 'drawn') {
    openTargets[0] = translucencyAttachment(rt)
    encoder.beginRenderPass(OPEN).end()
    markDrawn(targets)
    targets.modulated = false
    // The alpha holdout lays the image's alpha itself, the particles' layers not in it: the composition
    // leaves the alpha as it is, by the modulation target cleared to the alpha it keeps it by.
    if (holdoutPassOn(rt)) {
      openTargets[0] = modulationAttachment(rt)
      encoder.beginRenderPass(OPEN).end()
      targets.modulated = true
    }
  }
  return targets.colorView
}

/** `colour` on `view`, or an empty slot without one. */
export function attached(colour: GPURenderPassColorAttachment, view: GPUTextureView | undefined) {
  if (!view) return null
  colour.view = view
  return colour
}
