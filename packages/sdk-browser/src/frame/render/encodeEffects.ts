import { families } from '../../session/host/families.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { AccumulatedImage, ComposedImage } from '../../lighting/deferred/program.ts'
import type { OverlayFrame } from '../../post/effects/webgpuKinds.ts'
import type { PostFrame } from '../../post/finish/finish.ts'
import { activePasses } from '../../post/effects/targets.ts'
import type { EffectPass } from '../../../../sdk-core/src/world/effect/chain.ts'
import { composesFinish } from '../../post/finish/frame.ts'
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

/**
 * The world's effect chain on this image (`../../post/effects/webgpuEffects.ts`): the passes that
 * run before tone mapping, over the resolved linear image — `accumulated`, or the lit image when
 * the image does not accumulate —; returns what composition reads, `accumulated` itself when the
 * chain draws nothing, and the last bloom's glow when the composition takes it over. The chain's
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
  accumulated: AccumulatedImage | undefined,
  post: PostFrame | undefined,
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
  // After the resolve, at the display's size; else at the lit image's, which the composition
  // upscales (`composeSource`).
  const [width, height] = accumulated ? gpu.displaySize : gpu.targetSize
  // The composition adds the chain's last bloom: until its programs arrive, the image is drawn
  // without the chain, as while the chain's own programs compile (`loading`).
  const composes = !active || composesFinish(rt)
  if (!effects.ready(passes) || !composes) {
    gpu.effectsRevision = COMPILING
    return accumulated
  }
  const output = effects.encode(encoder, passes, input, width, height, post)
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
  !!rt.context.effects && rt.context.effects.revision !== rt.gpu.effectsRevision
