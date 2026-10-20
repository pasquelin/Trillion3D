import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { drawParticles } from '../../particles/webgpuParticleFrame.ts'
import { clearValueOf } from '../../../../../sdk-core/src/world/math/packedColour.ts'
import { directTiles, encodeDirectLights } from './encodeLights.ts'
import { finishVsmFrame } from './vsm/vsmFrameEnd.ts'
import { composesOffscreen } from '../../../diagnostic/gpuVariant.ts'
import { encodeTaaPass } from '../../../taa/frame.ts'
import { stochasticPhase } from '../../../taa/frameState.ts'
import { composedImage, encodeEffects, encodeOverlayEffects } from './encodeEffects.ts'
import { seedAsIsShare } from '../prepare/asIsShareTarget.ts'
import { directLightResources, readsAsIs, wantsContractLighting } from '../prepare/contractLight.ts'
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts'
import { beginDisplayFilter, endDisplayFilter } from './encodeDisplayFilter.ts'
import { bindBlend, encodeBlend, prepareBlend } from './encodeBlend.ts'
import { encodeFrontPass } from '../../blend/frontPass.ts'
import { encodeHeldVsmProjection } from './vsm/vsmProject.ts'
import {
  encodeDepthPyramid,
  encodeReflectionRadiance,
  encodeReflections,
} from '../../../reflections/frame.ts'
import { adoptRadianceImage } from '../../../reflections/radiance.ts'
import { viewProj } from '../helpers.ts'
import { encodeSeeThroughBackground, encodeXray } from '../../visibility/xray.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { lightViewCode, showsRaw } from '../../../visibility/shader/shadeMode.ts'
import { createFrameDifference } from './frameDifference.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'

const inverseViewProj = new Float64Array(16),
  cameraWorldArray: [number, number, number, number] = [0, 0, 0, 1]
/** The size of the image composed and the display's, refilled each image (`ComposeSource`). */
const source = { drawn: [1, 1] as readonly number[], shown: [1, 1] as readonly number[] }

/** What the proxy's pose reads of the deformation (`PoseHost`): one object, refilled for each call
 *  and emptied after it, so that an image allocates none. */
const poseHost = {
  pool: undefined as GPUBuffer | undefined,
  revision: 0,
  deformation: undefined as WebgpuPagesRuntime['vis']['deformation'],
  recordOf(world: object): number {
    return poseHost.deformation?.wordOfWorld(world) ?? 0
  },
}

/** The frame-difference view's resources, when this image of the main view shows it
 *  (`followFrameDifference`). */
function differenceOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.run.diagnostic !== 'frame-difference' || rt.views.active !== rt.views.main) return
  return (rt.gpu.frameDifference ??= createFrameDifference(device))
}

/** Lights the surfaces into the HDR target, draws the forward transparents over it, and composes the
 *  display image at its size; returns whether it landed on the presented swap-chain view. */
export function encodeSurfaceLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, run, capture } = rt,
    clear = clearValueOf(run.clearColor)
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.displayView)
    throw new Error('DEFERRED_UNAVAILABLE')
  const { deformation } = rt.vis
  poseHost.pool = rt.vis.concatPos
  poseHost.deformation = deformation
  poseHost.revision = deformation?.frame.revision ?? 0
  run.gpuSelection?.proxyPose(encoder, poseHost)
  poseHost.pool = poseHost.deformation = undefined
  // A view the resolve paints, and a lit view that measures, are shown in raw values; a view of
  // the lit image otherwise goes through the display chain as the lit image does (`showsRaw`).
  const [width, height] = gpu.targetSize,
    raw = showsRaw(run.diagnostic)
  invertMatrix4(inverseViewProj, viewProj)
  // The transparents are selected and ordered first; light lists encode before resolve, its inputs —
  // every lighting resource the blend group names made with them.
  const blendRuns = prepareBlend(rt, encoder)
  const direct = encodeDirectLights(rt, device, encoder, cam, viewProj)
  for (let i = 0; i < 4; i++) cameraWorldArray[i] = cam.viewPoint[i]
  // The transparents bound for the image, and their front pass drawn: their nearest depth and the
  // surface the trace reads.
  const blendKey = blendRuns ? bindBlend(rt, device) : undefined
  if (blendKey) encodeFrontPass(rt, device, encoder)
  // The depth's pyramid, complete with this image's transparents: the contact rays of the lights —
  // the shadows' projection, held until now — and the reflections march it.
  encodeDepthPyramid(rt, encoder)
  encodeHeldVsmProjection(rt)
  // What every surface reflects, traced here: the opaque ones, the resolve's input, and the
  // transparents' front one, which the translucent layers read; behind it, they read the same
  // view inline.
  encodeReflections(rt, encoder)
  gpu.deferred.bind(
    gpu.surfaces,
    gpu.depthView,
    gpu.hdrView,
    wantsContractLighting(rt),
    directLightResources(rt),
    (error) => rt.diag.diagnosticFailure('direct-lighting-program-failed', error),
  )
  // The jitter the raster drew this image with: the shadow level reads it.
  const taa = gpu.temporal?.frame
  gpu.deferred.setJitter(taa?.active ? taa.jitter : null, stochasticPhase(taa))
  gpu.deferred.setLightView(lightViewCode(run.diagnostic))
  gpu.deferred.update(inverseViewProj, cameraWorldArray, width, height, clear, raw, direct)
  gpu.deferred.light(encoder, gpu.hdrView)
  run.gpuDrawCalls++
  // A see-through view's opaque background, which its edges are drawn over
  // (`../../visibility/xray.ts`).
  encodeSeeThroughBackground(rt, encoder, clear)
  const blendShare = seedAsIsShare(rt, device, encoder)
  const filter = beginDisplayFilter(rt, device)
  // Bound again: the shadows' projection may have made a resource the blend group names since.
  encodeBlend(rt, device, encoder, blendKey && bindBlend(rt, device))
  drawParticles(rt, encoder, directTiles())
  // The see-through views' edges over the lit image and its transparents
  // (`../../visibility/xray.ts`).
  encodeXray(rt, device, encoder)
  // The lit image whole, before its resolve: the next image's reflections read it.
  encodeReflectionRadiance(rt, encoder)
  // Composition reads the temporal result, or the lit image without accumulation.
  const asIs = readsAsIs(rt)
  const accumulated = encodeTaaPass(rt, device, encoder, cam, gpu.hdrView, asIs, blendShare?.view)
  const effects = encodeEffects(rt, device, encoder, accumulated)
  const composed =
    asIs && blendShare && !accumulated
      ? composedImage(effects?.color ?? gpu.hdrView, blendShare.view, effects?.bloom)
      : effects
  // A diagnostic variant, a guide or a view placed at a canvas rectangle composes offscreen.
  const guided = guidesShown(rt),
    placed = !!rt.views.active.rect
  const presentation =
    capture.capturing || guided || placed || composesOffscreen(rt.context.diagnosticGpuVariant)
      ? undefined
      : gpu.presenter?.targetView(...gpu.displaySize)
  // The frame-difference view composes the display image alone, then draws its difference with
  // the image before onto the canvas (`frameDifference.ts`).
  const difference = presentation && differenceOf(rt, device)
  const shown = difference ? undefined : presentation
  run.gpuDrawCalls++
  // The resolve's image is at the display's size; the lit one, and the chain's over it, at the
  // size drawn, which the composition upscales.
  source.drawn = accumulated ? gpu.displaySize : gpu.targetSize
  source.shown = gpu.displaySize
  gpu.deferred.compose(encoder, gpu.displayView, clear, shown, composed, asIs, source)
  if (filter) endDisplayFilter(rt, filter, encoder, accumulated?.filter, shown)
  // The chain's passes after tone mapping, over the display image whole: an outline's line.
  encodeOverlayEffects(rt, device, encoder, shown)
  // Composition and filter wrote the canvas what they wrote the display colour: it holds it. The
  // difference's canvas holds no display colour: such a view is never held (`holdWebgpuFrame`).
  if (difference && presentation) difference.encode(encoder, gpu.displayTexture!, presentation)
  else if (presentation) gpu.presenter!.composed(gpu.displayTexture!, ...gpu.displaySize)
  if (guided) encodeWebgpuGuides(rt, encoder, cam)
  // The transparents read this frame's maps: the frame's buffers swap only now.
  finishVsmFrame(rt, encoder)
  // Every pass of the image that reads or writes the HDR target is encoded: the lit image becomes
  // the radiance pyramid's level 0, and the HDR target the next image lights is the other one.
  adoptRadianceImage(gpu)
  return !!presentation
}
