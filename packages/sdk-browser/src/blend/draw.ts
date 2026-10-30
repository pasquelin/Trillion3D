import { skyLightReadOf } from '../frame/render/skyLightState.ts'
import { bindForwardReflection } from '../lighting/reflections/group.ts'
import { blendEntries, blendGroupsOf } from './identity.ts'
import { waterRank } from './plan/planCull.ts'
import { markDrawn } from './translucency.ts'
import { createBlendOverdraw } from './overdraw.ts'
import { countsBlendOverdraw } from '../diagnostic/gpuVariant.ts'
import { onTarget, type BlendModePipelines, type RankedPipelines } from './stagePipelines.ts'
import type { DualPasses } from './pipelines.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'
import { modulatesScene } from '../materials/surface/materialBlending.ts'
import { noTransmissiveInView } from './expand/expansionFrame.ts'
import { DISPLAY_MASK_GROUP, type DisplayFilter } from './display/displayFilter.ts'
import { BLEND_RECT_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { blendGroupLayouts, blendLayoutsFor } from './groupLayouts.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { activeResponsive } from '../frame/prepare/responsiveTarget.ts'
import { holdoutPassOn } from '../frame/prepare/alphaHoldout.ts'
import { track } from '../lighting/deferred/compileLedger.ts'
import { holdoutTargetOf } from './holdout.ts'
import { encodeOit, prepareOit } from './oit/oitPass.ts'
import { oitProgramsWanted } from './oit/oitResources.ts'
import { layersReady, layersTarget, selectReduced, type LayersTarget } from './reducedView.ts'
import { reducedResponsiveOf, upsampleResponsive } from './translucencyResponsive.ts'
import { slotMayDraw, viewArgsWord, type DrawViews } from './expand/expansionViews.ts'
import { readFilmSetting } from '../../../sdk-core/src/contracts/filmOptions.ts'
import { effectsShown } from '../post/effects/stagePlan.ts'
import { applyHoldout, copyHoldoutStart, holdoutPassesReady } from './holdoutPasses.ts'
import { directLightResources } from '../frame/prepare/contractLight.ts'
import {
  allRuns,
  attached,
  cleared,
  blendDepth,
  dualAttachments,
  fillAllColour,
  holdoutColour,
  layReducedFeedback,
  responsiveColour,
  modulationAttachment,
  modulationAttachments,
  translucencyAttachment,
} from './drawColour.ts'
import {
  DISPLAY_MASK_PASS,
  BLEND_HOLDOUT_PASS,
  BLEND_RESPONSIVE_PASS,
  TRANSLUCENCY_MODULATION_PASS,
  TRANSPARENTS_PASS,
} from '../diagnostic/stage/passLabels.ts'

/**
 * Bind group of a blend pass: vertex buffers, item records, atlases and lighting. An item reads its
 * quantized pages in the page cache, or the float pool for a geometry its pages carry unquantized,
 * so ALL items share this group.
 */
function blendBindGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  return device.createBindGroup({
    layout: rt.vis.blendBindGroupLayout!,
    entries: (blendGroupsOf(rt).identity.entries[0] ??= blendEntries(rt)),
  })
}

/** The same group on the layout of the display-filtered pipelines (`blendGroupLayouts`): without the rectangle lights' pictures where that layout holds none. */
function filteredBlendGroup(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const entries = (blendGroupsOf(rt).identity.entries[0] ??= blendEntries(rt))
  return device.createBindGroup({
    layout: blendLayoutsFor(
      device,
      !!rt.vis.blendPipelines?.world.objectShadow,
      oitProgramsWanted(rt.setup.oitSortedPixels, device),
    ).filtered,
    entries: entries.filter(notRectPicture),
  })
}
const notRectPicture = ({ binding }: GPUBindGroupEntry) =>
  binding !== BLEND_RECT_BINDINGS.atlas && binding !== BLEND_RECT_BINDINGS.sampler

/** The pipelines of the program that lights the layers with the lights' key `key` (resolved when not
 *  given): none while the program that serves it compiles — no layer is drawn with one lacking the
 *  code the lights need —, the frame then held for it, if `askBlendReach` did not already. */
export function litBlendPipelines(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  key?: Partial<ContractKey>,
) {
  const { blendPipelines } = rt.vis,
    lights = key ?? directLightResources(rt),
    lobed = rt.blendState.lobed
  const pipelines = blendPipelines!.lit(lights, lobed)
  if (!pipelines)
    track(device, blendPipelines!.litAwaited(lights, lobed), true, 'blend lit program')
  return pipelines
}

/** The bind group every item shares in the image (group 0), made once per identity: the one a pass that draws
 *  the blend's programs without its runs — the water's composite — binds. */
export function sharedBlendGroup(rt: WebgpuPagesRuntime, device: GPUDevice, filtered = false) {
  const { identity, sharedGroups, filteredGroups } = blendGroupsOf(rt)
  return filtered && !blendGroupLayouts(device).pictures
    ? (filteredGroups[identity.slot] ??= filteredBlendGroup(rt, device))
    : (sharedGroups[identity.slot] ??= blendBindGroup(rt, device))
}

/**
 * Encodes slots `from` to `to` of the pass into an open render pass: one `drawIndirect` per SLOT,
 * and nothing else.
 *
 * The GPU ordered the pass and wrote each slot's argument (`runs.ts`); the CPU knows each slot's
 * pipeline and buffers without that order: a slot of the main class sets the main pipeline and the
 * paged group, an own slot sets its entry's, and the own entries' paint order is the one the CPU
 * ranked (`order/order.ts`), each slot's pipeline taken once a frame (`slotPipelines`). Draw primitives are rasterized instance by instance, in order: the paint
 * order is the one a draw per item gives — without the draws.
 *
 * The loop does no matrix product, no material read, no frustum test: the frustum verdict is the
 * GPU's (`verdict/verdictWgsl.ts`), which zeros the instances of what it rejects — an own entry wholly out
 * of view draws no instance, and a draw with no instance sets nothing.
 *
 * `pipelines` say what draws each rank; `options` (`BlendRuns`) what else the pass holds. Returns
 * the draws encoded.
 */
export function drawBlendRuns(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  pipelines: RankedPipelines,
  { filter, reflected = true, nearFirst = false, water, view = 0, group, waiting }: BlendRuns = {},
) {
  const { blendState } = rt,
    args = blendState.argsBuffer!
  // A view that keeps no item of the plan (`planFrameViews`) has nothing to draw.
  if (view < 0) return 0
  if (reflected) bindForwardReflection(pass, rt, skyLightReadOf(rt))
  if (filter) pass.setBindGroup(DISPLAY_MASK_GROUP, filter.maskGroup)
  // The groups of the identity the frame named (`voidStaleBlendGroups`), not a draw slot.
  // Nothing is offset per item: the record is read at the rank the vertex index carries, so the
  // group is set once for the whole list.
  pass.setBindGroup(0, group ?? sharedBlendGroup(rt, device, !!filter))
  let boundPipeline = -1,
    bound: GPURenderPipeline | undefined,
    encoded = 0
  // The view's arguments (`expand/expansionViews.ts`): the draws of the items it keeps alone.
  const base = (blendState.planRegion.args + viewArgsWord(blendState.maxPlanEntries, view)) * 4,
    ranks = blendState.slotPipelines
  const to = blendState.runCount
  for (let k = 0; k < to; k++) {
    const slot = nearFirst ? to - 1 - k : k
    const pipelineRank = ranks[slot]
    // A single-layer water rank is drawn by the water pass alone (`water: 'only'`) and by the front
    // pass besides (`'with'`): every other pass leaves it out.
    if (water !== 'with' && waterRank(pipelineRank) !== (water === 'only')) continue
    if (pipelines.skips?.(pipelineRank)) continue
    // A slot the CPU knows holds no instance of the view is not encoded.
    if (!slotMayDraw(blendState, view, slot)) continue
    if (boundPipeline !== pipelineRank) {
      boundPipeline = pipelineRank
      // A pipeline not compiled yet is asked by `at`; its draws are skipped, the frames waiting for it.
      const pipeline = pipelines.at(boundPipeline, !!filter)
      if (pipeline && pipeline !== bound) pass.setPipeline(pipeline)
      bound = pipeline
    }
    if (!bound) {
      if (waiting) waiting.slots++
      continue
    }
    encoded++
    pass.drawIndirect(args, base + slot * 16)
  }
  return encoded
}

/** What a pass drawing the runs holds besides their pipelines (`drawBlendRuns`): the display
 *  layers `filter` attached and its mask bound; the reflection group bound, but for a pass whose pipelines read none (`reflected`
 *  false: the front pass, the distortion); the slots near to far, against their paint order
 *  (`nearFirst`): a pass that writes depth and blends nothing (the front pass) then rejects early
 *  what lies behind. */
export type BlendRuns = {
  filter?: DisplayFilter
  reflected?: boolean
  nearFirst?: boolean
  /** The single-layer water's ranks (`waterRank`): drawn alone by the water pass (`'only'`), with the
   *  others by the front pass (`'with'`), by no other pass (unset). */
  water?: 'only' | 'with'
  /** The expansion's view the slots are drawn from (`expand/expansionViews.ts`): 0, the default, every layer. */
  view?: number
  /** The first group the runs are drawn with: the blend group of the image (`sharedBlendGroup`) unless a pass draws them on a layout of its own (a pass with a display `filter` draws on the filtered layout's group, `blendGroupLayouts`, and so passes none). */
  group?: GPUBindGroup
  /** Counts the slots the view keeps whose pipeline was not compiled yet: they were asked and not drawn. */
  waiting?: { slots: number }
}

/**
 * Encodes the forward transparent pass into the translucency target (`translucency.ts`), every
 * translucent layer lit in forward and composed in paint order over the depth of the opaque scene,
 * after the distortion was applied to the opaque scene (`distortion.ts`): the blends in their modes,
 * the transmissive layers under the dual blend where the device grants it and no display layer is
 * on, under its fallback otherwise; a layer that transmits all channels alike is one blend over and takes
 * the dual blend nowhere. Under the dual blend, which a scene with a chromatic layer asks for, the pass holds the translucency target
 * alone — WebGPU takes a dual blend on a single target only —, every layer in it, the blends'
 * feedback left to the modulation pass. The layers that multiply the
 * scene, and the chromatic layers' multiplication of it, draw in a pass of their own on the
 * modulation target (`drawModulation`), which then writes the feedback of every layer. Nothing is composed here: the effects read the lit image
 * first (`composeTranslucency`). Virtual-texture feedback is opened by `feedbackAttachment`, which
 * alone knows whether a pass of the frame already wrote it; the function says whether it opened a
 * pass. `key`, the frame's lights' key (`directLightResources`, resolved here when not given), picks
 * the program (`createForwardVariants`).
 */
export function drawBlendPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
  views: DrawViews = ALL_VIEWS,
): boolean {
  const { gpu, blendState } = rt,
    filter = gpu.displayFilter?.active ? gpu.displayFilter : undefined
  // Nothing to encode without runs, or without the arguments the GPU wrote for them.
  if (!blendState.runCount || !blendState.argsBuffer || !gpu.translucency?.active) return false
  // The smaller layers wait for their depth, made here (`layersReady`).
  if (!layersReady(gpu, device, encoder)) return false
  // Lit with the code the frame's lights need, on the opaque resolve's key (`pipelines.ts`), and
  // with lobe code while an item's surface carries a lobe (`physicalWgsl.ts`).
  const pipelines = litBlendPipelines(rt, device, key)
  if (!pipelines) return false
  if (filter) drawDisplayMask(rt, device, encoder, filter, pipelines.mask)
  // The passes that follow draw at the layers' size, the smaller one where the targets are (`selectReduced`).
  const target = layersTarget(gpu)
  if (target.apart) selectReduced(encoder, rt, true)
  // The dual blend's passes only while a chromatic transmissive item may be in view
  // (`noTransmissiveInView`), its colour pass and its modulation pass; a transmissive layer that
  // transmits all channels alike is one blend over, in the one pass on every target, and with no
  // transmissive item in view that pass skips the transmissive slots — which the verdict left
  // without an instance — (`DualPasses.blends`).
  // The alpha holdout lays the image's alpha itself: the composition leaves it as it is.
  const holdout = holdoutPassOn(rt)
  const passes = filter ? undefined : pipelines.dualPasses,
    inView = blendState.transmissive > 0 && !noTransmissiveInView(blendState, gpu),
    dual = passes && inView && blendState.chromatic ? passes : undefined,
    drawn = passes && !inView ? passes.blends : pipelines
  // Diagnostic only: the counting variant opens an occlusion query around the pass.
  const overdraw = countsBlendOverdraw(rt.context?.diagnosticGpuVariant)
    ? (blendState.overdraw ??= createBlendOverdraw(device))
    : undefined
  blendDepth.view = target.depth
  TRANSPARENTS.occlusionQuerySet = overdraw?.set
  TRANSPARENTS.colorAttachments = dual
    ? dualAttachments(rt)
    : fillAllColour(rt, filter, translucencyAttachment(rt))
  // The layers the pixels sort are left to their own pass, once this one has cleared the target (`encodeOit`).
  const sorted = prepareOit(rt, device, encoder, pipelines.oit, !!filter)
  const blended = onTarget(dual ? dual.colour : drawn, 'translucency')
  const pass = encoder.beginRenderPass(TRANSPARENTS)
  pass.setViewport(0, 0, target.size[0], target.size[1], 0, 1)
  overdraw?.begin(pass)
  allRuns.filter = filter
  allRuns.view = views.colour
  let encoded = drawBlendRuns(
    rt,
    device,
    pass,
    sorted ? sorted.pipelines.apart(blended) : blended,
    allRuns,
  )
  overdraw?.end(pass)
  pass.end()
  overdraw?.after(encoder)
  encoded += encodeOit(rt, device, encoder, sorted, (sortedPass, ranked) =>
    drawBlendRuns(rt, device, sortedPass, ranked, { view: views.colour, nearFirst: true }),
  )
  encoded += drawModulation(rt, device, encoder, dual, drawn, allRuns, holdout, target)
  encoded += drawResponsive(rt, device, encoder, pipelines, views.responsive, target)
  if (target.apart) {
    encoded += layReducedFeedback(rt, device, encoder)
    selectReduced(encoder, rt, false)
  }
  markDrawn(gpu.translucency)
  countBlendDraws(rt, encoded)
  return true
}

/** The transparents' passes' descriptors, held: each pass rewrites the attachments it changes. */
const TRANSPARENTS: GPURenderPassDescriptor = {
  label: TRANSPARENTS_PASS,
  colorAttachments: [],
  depthStencilAttachment: blendDepth,
}
const MODULATION: GPURenderPassDescriptor = {
  label: TRANSLUCENCY_MODULATION_PASS,
  colorAttachments: [],
  depthStencilAttachment: blendDepth,
}
const responsiveTargets: (GPURenderPassColorAttachment | null)[] = [null]
const RESPONSIVE: GPURenderPassDescriptor = {
  label: BLEND_RESPONSIVE_PASS,
  colorAttachments: responsiveTargets,
  depthStencilAttachment: blendDepth,
}
/** The marks of the smaller layers' responsiveness, cleared by the pass that draws them. */
const marksCleared = cleared([0, 0, 0, 0])
const HOLDOUT: GPURenderPassDescriptor = {
  label: BLEND_HOLDOUT_PASS,
  colorAttachments: [holdoutColour],
  depthStencilAttachment: blendDepth,
}
const maskTargets: (GPURenderPassColorAttachment | null)[] = []
const maskDepth = { depthReadOnly: true } as GPURenderPassDepthStencilAttachment
const DISPLAY_MASK: GPURenderPassDescriptor = {
  label: DISPLAY_MASK_PASS,
  colorAttachments: maskTargets,
  depthStencilAttachment: maskDepth,
}

/** The views of a lone draw: every layer, and the responsiveness of all of them. */
const ALL_VIEWS: DrawViews = { colour: 0, responsive: 0 }

/**
 * The pass on the modulation target (`translucency.ts`), cleared to white by it: the layers that
 * multiply the scene (`modulatesScene`) draw their colour in it, and under the dual blend the
 * transmissive layers theirs — the destination multiplied by what they transmit —, with the virtual-texture feedback of
 * every layer where the pipelines write it (`createDualPasses`); on the targets of the pass before it (`runs`, the options it drew its
 * runs with) otherwise. A frame whose plan holds none of them encodes no pass: the target stays as
 * it was and the composition reads a white texel in its place (`TranslucencyTargets.modulated`) —
 * but under the alpha holdout, where the pass clears the target to the alpha it keeps the image's by.
 * Returns the draws encoded.
 */
function drawModulation(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  dual: DualPasses | undefined,
  drawn: RankedPipelines,
  runs: BlendRuns,
  keepsAlpha: boolean,
  target: LayersTarget,
) {
  const { gpu, blendState } = rt
  const modulates = !!dual || keepsAlpha || blendState.planModes.some(modulatesScene)
  gpu.translucency!.modulated = modulates
  if (!modulates) return 0
  MODULATION.colorAttachments = dual
    ? modulationAttachments(rt, rt.vis.writesFeedback)
    : fillAllColour(rt, runs.filter, modulationAttachment(rt))
  const pass = encoder.beginRenderPass(MODULATION)
  pass.setViewport(0, 0, target.size[0], target.size[1], 0, 1)
  const encoded = drawBlendRuns(
    rt,
    device,
    pass,
    dual ? dual.modulate : onTarget(drawn, 'modulation'),
    runs,
  )
  pass.end()
  return encoded
}

/**
 * The responsiveness pass, the translucent layers drawn again into the responsive target
 * (`responsive.ts`), on every device and in every mode: each layer leaves the mark of its surface's
 * responsiveness code where its opacity is above 0 and under the clip value of its opacity mask plus
 * a 255th (`fsBlendResponsive`, `fsTransmitResponsive`), a thin translucent layer as if its opacity
 * were one, the largest mark kept. The depth test against the opaque scene is the pass's, at the depth
 * a surface's `pixelDepthOffset` moves the pixel to. None where the image writes no responsiveness.
 * Returns the draws encoded.
 */
function drawResponsive(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: BlendModePipelines,
  view: number,
  target: LayersTarget,
) {
  const { gpu } = rt,
    responsive = activeResponsive(rt)
  if (!responsive) return 0
  const set = gpu.translucency!,
    [width, height] = target.size
  blendDepth.view = target.depth
  // The smaller layers mark a target of their size, laid over the image's afterwards (`upsampleResponsive`).
  responsiveTargets[0] = target.apart
    ? attached(marksCleared, reducedResponsiveOf(device, set.reduced!, set.extent))
    : attached(responsiveColour, responsive.view)
  const pass = encoder.beginRenderPass(RESPONSIVE)
  pass.setViewport(0, 0, width, height, 0, 1)
  const encoded = drawBlendRuns(rt, device, pass, pipelines.responsive, { reflected: false, view })
  pass.end()
  if (target.apart) upsampleResponsive(device, encoder, set, responsive.view, gpu.targetSize)
  return encoded
}

/**
 * The alpha holdout (`holdout.ts`), the translucent layers drawn again from far to near into the target
 * of their own: it starts as the lit image's alpha, and each layer lays what it leaves of the
 * background visible over it (`fsBlendHoldout`, `fsTransmitHoldout`) — every layer of every pass of
 * the translucency, whichever set it is composed with —; the visibility it ends with replaces the
 * lit image's alpha (`applyHoldout`), which the composition of the layers leaves as it is. Called
 * once the image's layers are drawn, selecting every pass of them; `particles` lays the pools' there
 * too (the caller gives it where the alpha holdout is not in effect). Returns the draws encoded.
 */
export function encodeHoldout(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  key?: Partial<ContractKey>,
  particles?: (held: GPUTextureView) => void,
) {
  const { gpu, blendState } = rt,
    targets = gpu.translucency
  if (!holdoutPassOn(rt) || !blendState.runCount || !blendState.argsBuffer) return 0
  if (!targets?.active || !gpu.hdrView) return 0
  // The start, the accumulation and the application are one chain: none is encoded (the image keeps
  // its alpha, `particles` lay nothing) while a pass of it compiles.
  if (!holdoutPassesReady(device)) return 0
  const pipelines = litBlendPipelines(rt, device, key)
  if (!pipelines) return 0
  const held = holdoutTargetOf(device, targets)
  copyHoldoutStart(device, encoder, gpu.hdrView, held, gpu.targetSize)
  holdoutColour.view = held
  blendDepth.view = gpu.depthView!
  const pass = encoder.beginRenderPass(HOLDOUT)
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  const encoded = drawBlendRuns(rt, device, pass, pipelines.holdout, { reflected: false })
  pass.end()
  particles?.(held)
  // Laid over the lit image at once, or, as the setting says, once the depth of field has drawn
  // (`applyPendingHoldout`) — where the image shows no effect there is none to wait for.
  const later = readFilmSetting(rt, 'translucencyHoldoutLocation') === 'afterDepthOfField'
  if (later && effectsShown(rt)) targets.holdout!.pending = true
  else applyHoldout(device, encoder, gpu.hdrView, held, gpu.targetSize)
  return encoded
}

/** Lays the holdout `encodeHoldout` kept for the depth of field's end over `lit`, the image it left: its
 *  alpha only where a layer left something. Nothing where none is kept. */
export function applyPendingHoldout(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  lit: GPUTextureView,
) {
  const held = rt.gpu.translucency?.holdout
  if (!held?.pending) return
  held.pending = false
  applyHoldout(device, encoder, lit, held.view, rt.gpu.targetSize, true)
}

/** The display mask: the blends' filtering surfaces alone, depth-tested, before the blend pass. */
function drawDisplayMask(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  filter: DisplayFilter,
  mask: BlendModePipelines['mask'],
) {
  const { gpu, run } = rt
  maskTargets.length = 0
  for (let slot = 0; slot < mask.slot; slot++) maskTargets.push(null)
  maskTargets.push(filter.maskAttachment())
  maskDepth.view = gpu.depthView!
  const pass = encoder.beginRenderPass(DISPLAY_MASK)
  pass.setViewport(0, 0, gpu.targetSize[0], gpu.targetSize[1], 0, 1)
  run.gpuDrawCalls += drawBlendRuns(rt, device, pass, mask)
  pass.end()
}

/** Frame counters of a transparent pass: draws, and the triangles its clusters submit. */
export function countBlendDraws(rt: WebgpuPagesRuntime, encoded: number) {
  const { run } = rt
  run.gpuDrawCalls += encoded
  run.blendDrawCalls += encoded
  run.blendSubmittedTriangles = run.blendPagedTriangles
}
