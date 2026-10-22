import { families } from '../../session/host/families.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { AccumulatedImage, ComposedImage } from '../../lighting/deferred/program.ts'
import type { OverlayFrame, ResolveFrame } from '../../post/effects/webgpuKinds.ts'
import type { PostFrame } from '../../post/finish/finish.ts'
import { activePasses } from '../../post/effects/targets.ts'
import type { EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { composesFinish } from '../../post/finish/frame.ts'
import { blurPlan, blurSettingsMoved, blurShown } from '../../post/effects/blurPlan.ts'
import { bloomSettingsMoved, bloomValues } from '../../post/effects/bloom/bloomSettings.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import {
  MOTION_BLUR_RULES,
  type MotionBlurValues,
} from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { Velocity } from '../../post/taa/velocity.ts'
import { velocitySettling } from '../../post/taa/velocityFrame.ts'
import { appliedExposureOf } from '../../post/exposure/applied.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { viewProj } from '../backend/helpers.ts'
import { beautyImage } from '../backend/state/renderScale.ts'

/** The passes of a stage that draw, rewritten by each image: an image allocates none. */
const drawing: EffectPass[] = []

/** The image composition reads, kept from frame to frame: an image allocates none. */
const composed: ComposedImage = {
  color: undefined as unknown as GPUTextureView,
}
export function composedImage(
  color: GPUTextureView,
  share?: GPUTextureView,
  glow?: ComposedImage['glow'],
  finish?: ComposedImage['finish'],
) {
  composed.color = color
  composed.share = share
  composed.glow = glow
  composed.finish = finish
  return composed
}

/** The world's effect chain on the GPU, made at the first image that needs it once its code
 *  arrived (`../../session/host/families.ts`); none before. */
function webgpuEffects(rt: WebgpuPagesRuntime, device: GPUDevice) {
  return (rt.gpu.effects ??= families.effects
    .get()
    ?.createWebgpuEffects(device, (error) =>
      rt.diag.diagnosticFailure('effects-unavailable', error),
    ))
}

/** The revision an image drawn while the chain compiles keeps: no chain's, which count from 0. */
const COMPILING = -1

/** What the passes on the resolved image read of the frame, rewritten by each image: an image
 *  allocates none. */
const resolveFrame = {} as ResolveFrame
/** The blur of an image that has none to draw: no pass, its settings those of its defaults. */
const NO_PASSES: readonly EffectPass[] = []
const NO_SETTINGS = resolveSettings(MOTION_BLUR_RULES, {})
const NO_DEPTH_OF_FIELD = resolveSettings(DEPTH_OF_FIELD_RULES, {})
/** The camera the passes on the resolved image read, rewritten by each image. */
const resolveCamera = {
  projection: [] as ArrayLike<number>,
  perspective: true,
  near: 0,
  exposure: 1,
}
/** The image the passes on the resolved image leave: its colour, the share and the layers of the
 *  image they were handed. */
const resolvedImage = {} as ComposedImage

/** What the passes on the resolved image read of the image: its own size — the display's after the
 *  temporal resolve, else the lit image's, drawn in the top-left of textures of the largest size —,
 *  the grid the motion was measured at, the motion the velocity stage measured and how the blur is
 *  drawn. */
function readResolveFrame(
  frame: ResolveFrame,
  gpu: WebgpuPagesRuntime['gpu'],
  accumulated: boolean,
  settings: MotionBlurValues,
  velocity: Velocity | undefined,
) {
  frame.size = accumulated ? gpu.displaySize : gpu.targetSize
  frame.extent = accumulated ? gpu.displaySize : gpu.allocatedSize
  frame.render = gpu.targetSize
  frame.depth = gpu.depthView!
  frame.settings = settings
  frame.now = cpuNow()
  if (!velocity) return
  frame.allocated = velocity.size
  frame.vectors = velocity.vectors
  frame.view = velocity.uniform
  frame.still = velocity.still
}

/** What the depth of field reads of the image besides its size: how it is drawn (`DEPTH_OF_FIELD_RULES`)
 *  and the camera — its projection, whether it is a perspective one, its nearest distance drawn — and
 *  the exposure the image is shown at. */
function readResolveCamera(
  frame: ResolveFrame,
  depthOfField: ResolveFrame['depthOfField'],
  cam: EngineCamera,
  exposure: number,
) {
  resolveCamera.projection = cam.projection
  resolveCamera.perspective = cam.perspective !== 0
  resolveCamera.near = cam.near
  resolveCamera.exposure = exposure
  frame.depthOfField = depthOfField
  frame.camera = resolveCamera
}

/**
 * The world's passes on the resolved image (`../../post/effects/webgpuEffects.ts`), the depth of field and the motion
 * blur: drawn before the exposure is measured and before every other pass of the finishing, from
 * the motion the velocity stage measured for this image (`../../post/taa/velocityFrame.ts`), on
 * the temporal pass's image where it ran, else on the lit image; returns the image the rest of the
 * image reads — `accumulated` itself when none draws, or a view that shows raw values or is not
 * finished, which has no motion to blur; the lit image, `undefined`, when the temporal pass did not
 * run. The image keeps the as-is share of the one it was handed; the history the temporal pass
 * keeps is the unblurred one.
 */
export function encodeResolvedEffects(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  accumulated: AccumulatedImage | undefined,
  cam: EngineCamera,
): ComposedImage | undefined {
  const { gpu } = rt
  const input = accumulated?.color ?? gpu.hdrView
  if (!input || !gpu.depthView || !blurShown(rt)) return accumulated
  // Once a blur drew, a chain without one still frees what the blur held.
  const plan = blurPlan(rt)
  if (!plan && !gpu.effects) return accumulated
  const passes = plan?.passes ?? NO_PASSES
  const effects = webgpuEffects(rt, device)
  const velocity = gpu.velocity?.measured ? gpu.velocity : undefined
  // Until its programs arrive, or while the stage did not measure, the image is drawn unblurred
  // (`loading`, `encodeEffects`).
  if (!effects?.readyResolved(passes) || (plan?.motion && !velocity)) return accumulated
  readResolveFrame(resolveFrame, gpu, !!accumulated, plan?.settings ?? NO_SETTINGS, velocity)
  readResolveCamera(
    resolveFrame,
    plan?.depthOfField ?? NO_DEPTH_OF_FIELD,
    cam,
    appliedExposureOf(rt),
  )
  const color = effects.resolve(encoder, passes, input, resolveFrame)
  rt.run.gpuDrawCalls += effects.resolvedPasses
  if (color === input) return accumulated
  resolvedImage.color = color
  resolvedImage.share = accumulated?.share
  return resolvedImage
}

/**
 * The world's effect chain on this image (`../../post/effects/webgpuEffects.ts`): the passes that
 * run before tone mapping, over the resolved linear image — `accumulated`, or the lit image when
 * there is none — of `drawn` pixels: the display's after the temporal resolve, else the lit
 * image's, which the composition upscales (`composeSource`). Returns what composition reads,
 * `accumulated` itself when the chain draws nothing, and the last bloom's glow when the composition takes it over. The chain's
 * output keeps the as-is share of the image it read. `post` is what the display finishing shares
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
): ComposedImage | undefined {
  const chain = rt.context.effects,
    { gpu, run } = rt
  if (!chain) return accumulated
  gpu.effectsRevision = chain.revision
  const passes = chain.stage('before-tone-mapping')
  // The chain keeps its targets meanwhile.
  if (!post) return accumulated
  const active = activePasses(passes, drawing).length > 0
  const input = accumulated?.color ?? gpu.hdrView
  if ((!active && !gpu.effects) || !input) return accumulated
  // Its code, which the frame waited for (`../../session/host/families.ts`), arrived.
  const effects = webgpuEffects(rt, device)
  if (!effects) return accumulated
  const [width, height] = drawn
  // The composition adds the chain's last bloom: until its programs arrive, the image is drawn
  // without the chain, as while the chain's own programs compile (`loading`).
  const composes = !active || composesFinish(rt)
  if (!effects.ready(passes) || !composes) {
    gpu.effectsRevision = COMPILING
    return accumulated
  }
  const output = effects.encode(encoder, passes, input, width, height, post, bloomValues(rt))
  if (effects.loading) gpu.effectsRevision = COMPILING
  run.gpuDrawCalls += effects.draws
  const glow = effects.blend?.glow
  if (output === input && !glow) return accumulated
  return composedImage(output, accumulated?.share, glow)
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
  if (!gpu.effects && !activePasses(passes, drawing).length) return 0
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
  const drawn = effects.overlay(encoder, passes, overlayFrame)
  if (effects.loading) gpu.effectsRevision = COMPILING
  run.gpuDrawCalls += drawn
  return drawn
}

/** True when the last encoded image lacks the chain as the page holds it — changed since, or
 *  still compiling: a held frame would miss it. The chain runs after the resolve, so neither
 *  moves the accumulation. */
export const effectsMoved = (rt: WebgpuPagesRuntime) =>
  !!rt.context.effects &&
  (rt.context.effects.revision !== rt.gpu.effectsRevision ||
    blurSettingsMoved(rt) ||
    bloomSettingsMoved(rt) ||
    velocitySettling(rt))
