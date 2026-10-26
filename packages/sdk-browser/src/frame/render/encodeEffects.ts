import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { AccumulatedImage, ComposedImage } from '../../lighting/deferred/program.ts'
import type { OverlayFrame } from '../../post/effects/webgpuKinds.ts'
import type { PostFrame } from '../../post/finish/finish.ts'
import type { EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { composesFinish } from '../../post/finish/frame.ts'
import { effectsShown, stagePlan, type PlanStage } from '../../post/effects/stagePlan.ts'
import { velocitySettling } from '../../post/taa/velocityFrame.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { viewProj } from '../backend/helpers.ts'
import { beautyImage } from '../prepare/lit.ts'
import { readResolveFrame, resolveFrame, webgpuEffects } from './effectsFrame.ts'
import { markFused, settle } from '../../blend/translucency.ts'
import { composeLateImage } from '../../blend/translucencyCompose.ts'
import { applyPendingHoldout } from '../../blend/draw.ts'
import { splitsTranslucency } from '../../blend/translucencyPhase.ts'
import { measureBeforeTranslucency } from '../../post/taa/frame.ts'

/** The passes of a stage that draw, rewritten by each image: an image allocates none. */
const drawing: EffectPass[] = []

/** The image composition reads, kept from frame to frame: an image allocates none. */
const composed: ComposedImage = {
  color: undefined as unknown as GPUTextureView,
}
export function composedImage(
  color: GPUTextureView,
  glow?: ComposedImage['glow'],
  finish?: ComposedImage['finish'],
) {
  composed.color = color
  composed.glow = glow
  composed.finish = finish
  return composed
}

/** The revision an image drawn while the chain compiles keeps: no chain's, which count from 0. */
const COMPILING = -1

/** The passes of a stage the chain holds none of. */
const NO_PASSES: readonly EffectPass[] = []
/** The image the passes on the resolved image leave, or the temporal pass's: its colour, and the
 *  half-size image written beside the colour where a pass wrote one (`WebgpuResolveKind.half`,
 *  `AccumulatedImage.half`), which the scene's chain reads in place of the pass that draws it
 *  (`../../post/filters/sceneChain.ts`). */
export type ResolvedImage = ComposedImage & { half?: GPUTextureView }
const resolvedImage = {} as ResolvedImage
/** The image the late layers are composed into, as the passes after read it. */
const lateImage = {} as ResolvedImage

/**
 * The passes of `stage` on `input`, from the motion the velocity stage measured for this image
 * (`../../post/taa/velocityFrame.ts`): the view returned, `input` itself — `undefined`, where a pass
 * is waited for — when none drew. Until their programs arrive, or while the stage did not measure a
 * motion they read, the image is drawn without them (`loading`, `encodeEffects`). A stage with none
 * that draws still frees what a pass held, once one drew.
 */
function drawStage(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  stage: PlanStage,
  input: GPUTextureView,
  atDisplay: boolean,
) {
  const { gpu } = rt
  const plan = stagePlan(rt, stage)
  if (!plan && !gpu.effects?.stage(stage).holds) return undefined
  const passes = plan?.passes ?? NO_PASSES
  const effects = webgpuEffects(rt, device)
  const velocity = gpu.velocity?.measured ? gpu.velocity : undefined
  const at = effects?.stage(stage)
  if (!at?.ready(passes) || (plan?.motion && !velocity)) return undefined
  readResolveFrame(resolveFrame, rt, cam, stage, atDisplay, velocity)
  const color = at.resolve(encoder, passes, input, resolveFrame)
  rt.run.gpuDrawCalls += at.passes
  return color === input ? undefined : color
}

/**
 * The world's passes on the lit image, before the temporal pass resolves it (`../../post/effects/webgpuEffects.ts`),
 * the depth of field: drawn at the size the image is drawn, from the motion the velocity stage measured
 * for it. Returns the image the temporal pass — or, without it, the rest of the image — reads in place of
 * the lit one, `undefined` when no pass drew, a view that shows raw values or is not finished included.
 * The lit image itself is left as it is: the next image's reflections read it.
 */
export function encodeLitEffects(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  if (!gpu.hdrView || !gpu.depthView || !effectsShown(rt)) return undefined
  // The depth of field composes the layers drawn after it: the temporal pass measures the lit image
  // before they lie on it (`measureBeforeTranslucency`).
  if (splitsTranslucency(rt)) measureBeforeTranslucency(rt, encoder, gpu.hdrView)
  resolveFrame.layersComposed = false
  const color = drawStage(rt, device, encoder, cam, 'before-resolve', gpu.hdrView, false)
  if (resolveFrame.layersComposed && gpu.translucency) markFused(gpu.translucency)
  // The alpha holdout the setting lays after the depth of field.
  applyPendingHoldout(rt, device, encoder, color ?? gpu.hdrView)
  return color
}

/**
 * The world's passes on the resolved image (`../../post/effects/webgpuEffects.ts`), the motion
 * blur: drawn before the exposure is measured and before every other pass of the finishing, from
 * the motion the velocity stage measured for this image, on the temporal pass's image where it ran,
 * else on `lit`, the lit image or what the passes before the temporal pass made of it; returns the image
 * the rest of the image reads — `accumulated` itself when none draws, or a view that shows raw values or is
 * not finished, which has no motion to blur; `undefined` when the temporal pass did not run. The
 * history the temporal pass keeps is the unblurred one. Its half-size image is the blur's own, written as it stores the image, where the
 * blur drew; the temporal pass's where nothing did. The layers drawn after the motion blur are
 * composed over what it leaves, into an image of their own (`composeLateImage`), whose half-size
 * image the chain makes itself.
 */
export function encodeResolvedEffects(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  accumulated: AccumulatedImage | undefined,
  cam: EngineCamera,
  lit = rt.gpu.hdrView,
): ResolvedImage | undefined {
  resolveFrame.lateComposed = false
  const resolved = drawResolved(rt, device, encoder, accumulated, cam, lit)
  // The last motion blur laid the layers drawn after it over its image as it wrote it.
  if (resolveFrame.lateComposed && rt.gpu.translucency?.late) settle(rt.gpu.translucency.late)
  const scene = resolved?.color ?? lit
  if (!scene || !effectsShown(rt)) return resolved
  const size = accumulated ? rt.gpu.displaySize : rt.gpu.targetSize
  const color = composeLateImage(rt, device, encoder, scene, size)
  if (!color) return resolved
  lateImage.color = color
  lateImage.half = undefined
  return lateImage
}

/** The passes on the resolved image: `accumulated` itself where none draws. */
function drawResolved(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  accumulated: AccumulatedImage | undefined,
  cam: EngineCamera,
  lit: GPUTextureView | undefined,
): ResolvedImage | undefined {
  const input = accumulated?.color ?? lit
  if (!input || !rt.gpu.depthView || !effectsShown(rt)) return accumulated
  const color = drawStage(rt, device, encoder, cam, 'after-resolve', input, !!accumulated)
  if (!color) return accumulated
  resolvedImage.color = color
  resolvedImage.half = rt.gpu.effects?.stage('after-resolve').half
  return resolvedImage
}

/**
 * The world's effect chain on this image (`../../post/effects/webgpuEffects.ts`): the passes that
 * run before tone mapping, over the resolved linear image — `accumulated`, or the lit image when
 * there is none — of `drawn` pixels: the display's after the temporal resolve, else the lit
 * image's, which the composition upscales (`composeSource`). Returns what composition reads,
 * `accumulated` itself when the chain draws nothing, and the last bloom's glow when the composition takes it over. `post` is what the display finishing shares
 * with it (`../../post/finish/frame.ts`); none for a view the finishing leaves as it is — the
 * chain draws nothing there, a view lit by no declared lamp showing its albedo, a diagnostic view
 * and a surface capture the engine's image as it is. The revision drawn is kept, so a change of
 * the chain breaks the hold (`../loop/hold.ts`); an image drawn while its programs compile keeps
 * none, so the loop draws it again once they arrive (`../loop/interactiveFrame.ts`), without
 * restarting the accumulation.
 */
export function encodeEffects(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  accumulated: ComposedImage | undefined,
  post: PostFrame | undefined,
  drawn: readonly number[],
  lit = rt.gpu.hdrView,
): ComposedImage | undefined {
  const chain = rt.context.effects,
    { gpu, run } = rt
  if (!chain) return accumulated
  gpu.effectsRevision = chain.revision
  const passes = chain.stage('before-tone-mapping')
  // The chain keeps its targets meanwhile.
  if (!post) return accumulated
  const toDraw = gpu.kindSettings.drawn(passes, rt.context, drawing)
  const active = toDraw.length > 0
  const input = accumulated?.color ?? lit
  if ((!active && !gpu.effects) || !input) return accumulated
  // Its code, which the frame waited for (`../../session/host/families.ts`), arrived.
  const effects = webgpuEffects(rt, device)
  if (!effects) return accumulated
  const [width, height] = drawn
  // The composition adds the chain's last bloom: until its programs arrive, the image is drawn
  // without the chain, as while the chain's own programs compile (`loading`).
  const composes = !active || composesFinish(rt)
  if (!effects.ready(toDraw) || !composes) {
    gpu.effectsRevision = COMPILING
    return accumulated
  }
  const output = effects.encode(encoder, toDraw, input, width, height, post, rt.context)
  if (effects.loading) gpu.effectsRevision = COMPILING
  run.gpuDrawCalls += effects.draws
  const { blend } = effects
  if (output === input && !blend) return accumulated
  return composedImage(output, blend)
}

/** What the overlays read of the frame, kept from frame to frame: an image allocates none. */
const overlayFrame = {} as OverlayFrame

/**
 * The world's passes after tone mapping, drawn over the composed display image and the canvas it
 * was presented to (`presentation`), in chain order (`../../post/effects/webgpuEffects.ts`); returns
 * the render passes drawn. A chain with none, or whose passes are all idle — an outline of no
 * object —, draws and holds nothing; a diagnostic view or a capture shows the image without them,
 * as without the passes before. While their programs compile the image keeps no revision, so the
 * loop draws it again once they arrive.
 */
export function encodeOverlayEffects(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  presentation: GPUTextureView | undefined,
) {
  const chain = rt.context.effects,
    { gpu, vis, run } = rt
  if (!chain) return 0
  const passes = chain.stage('after-tone-mapping')
  if (!passes.length) {
    gpu.effects?.releaseOverlays()
    return 0
  }
  if (!beautyImage(rt)) return 0
  if (!gpu.displayView || !vis.visView || !vis.pageTable) return 0
  // Idle passes alone, before any pass made the chain: nothing to make for them.
  const toDraw = gpu.kindSettings.drawn(passes, rt.context, drawing)
  if (!gpu.effects && !toDraw.length) return 0
  const effects = webgpuEffects(rt, device)
  if (!effects) return 0
  overlayFrame.display = gpu.displayView
  overlayFrame.presentation = presentation
  overlayFrame.size = gpu.displaySize
  overlayFrame.pixelRatio = rt.setup.pixelRatio()
  overlayFrame.ids = vis.visView
  overlayFrame.idSize = gpu.targetSize
  overlayFrame.pages = vis.pageTable
  overlayFrame.layout = rt.layout
  overlayFrame.viewProj = viewProj
  overlayFrame.revisions = run.gate.revisions
  const drawn = effects.overlay(encoder, toDraw, overlayFrame)
  if (effects.loading) gpu.effectsRevision = COMPILING
  run.gpuDrawCalls += drawn
  return drawn
}

/** Whether the view's settings of the effect kinds the chain draws moved since the image before
 *  (`../../post/effects/kindSettings.ts`): none before an image drew the chain. */
const kindSettingsMoved = (rt: WebgpuPagesRuntime) =>
  rt.gpu.kindSettings.moved(rt.context.effects!.passes, rt.context)

/** True when the last encoded image lacks the chain as the page holds it — changed since, or
 *  still compiling: a held frame would miss it. The chain runs after the resolve, so neither
 *  moves the accumulation. */
export const effectsMoved = (rt: WebgpuPagesRuntime) =>
  !!rt.context.effects &&
  (rt.context.effects.revision !== rt.gpu.effectsRevision ||
    kindSettingsMoved(rt) ||
    velocitySettling(rt))
