import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { drawParticles } from '../../particles/gpu/webgpuParticleFrame.ts'
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts'
import { directTiles, encodeDirectLights } from './encodeLights.ts'
import { finishVsmFrame } from '../../lighting/shadows/vsm/frame/vsmFrameEnd.ts'
import { composesOffscreen } from '../../diagnostic/gpuVariant.ts'
import { encodeTaaPass } from '../../post/taa/frame.ts'
import { encodeVelocity } from '../../post/taa/velocityFrame.ts'
import { encodeExposure, exposureSettings } from '../../post/exposure/frame.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { encodeFinish, finishedGroup } from '../../post/finish/frame.ts'
import { stochasticPhase } from '../../post/taa/frameState.ts'
import {
  composedImage,
  encodeEffects,
  encodeOverlayEffects,
  encodeResolvedEffects,
} from './encodeEffects.ts'
import { seedAsIsShare } from '../prepare/asIsShareTarget.ts'
import { directLightResources, readsAsIs, wantsContractLighting } from '../prepare/contractLight.ts'
import { encodeAtmosphere } from './encodeAtmosphere.ts'
import { encodeCloudShadow } from './encodeCloudShadow.ts'
import { encodeSkyLight } from './encodeSkyLight.ts'
import { encodeSkyAndClouds, requestSkyAir } from './encodeClouds.ts'
import { encodeFogVolume } from './encodeFogVolume.ts'
import {
  encodeLightShaftBloom,
  encodeLightShaftOcclusion,
} from '../../modules/sky/lightShafts/frame.ts'
import { encodeWebgpuGuides, guidesShown } from './encodeGuides.ts'
import { beginDisplayFilter, endDisplayFilter } from './encodeDisplayFilter.ts'
import { bindBlend, encodeBlend, prepareBlend } from './encodeBlend.ts'
import { encodeFrontPass } from '../../blend/frontPass.ts'
import { encodeHeldVsmProjection } from '../../lighting/shadows/vsm/frame/vsmProject.ts'
import {
  encodeDepthPyramid,
  encodeReflectionRadiance,
  encodeReflections,
} from '../../lighting/reflections/frame.ts'
import { adoptRadianceImage } from '../../lighting/reflections/radiance/radiance.ts'
import { encodeScreenProbes } from '../../lighting/bounce/screen/frame.ts'
import { encodeSkyOcclusion } from './encodeSkyOcclusion.ts'
import { encodeAmbientOcclusion } from '../../lighting/ao/frame.ts'
import { viewProj } from '../backend/helpers.ts'
import { encodeSeeThroughBackground, encodeXray } from '../../visibility/passes/xray.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { lightViewCode, showsRaw } from '../../visibility/shader/shadeMode.ts'
import { createFrameDifference } from './frameDifference.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { reflects, rewritesSurfaces, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import { encodeSurfaceRewrite } from '../../lighting/deferred/surfaceOverride.ts'
import { encodeUnlitLights } from './captureLights.ts'

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

/** The image the composition reads, and the size it is composed at (`source`): the exposure measured
 *  on the radiance the image holds, the finishing's passes, the chain's, and the group that
 *  finishes it — its local exposure, the chain's glow, the vignette — when it draws any; the lit
 *  image is the HDR target the lighting wrote. */
function encodeImageChain(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  accumulated: ReturnType<typeof encodeTaaPass>,
  blendShare: ReturnType<typeof seedAsIsShare>,
  asIs: boolean,
  raw: boolean,
) {
  const { gpu } = rt,
    lit = gpu.hdrView!
  // The resolve's image is at the display's size; the lit one, and the chain's over it, at the
  // size drawn, which the composition upscales.
  source.drawn = accumulated ? gpu.displaySize : gpu.targetSize
  source.shown = gpu.displaySize
  // The passes on the resolved image first, the motion blur: the exposure, the finishing and the
  // chain read the image they leave.
  const resolved = encodeResolvedEffects(rt, device, encoder, accumulated, cam)
  // The exposure the composition multiplies by, measured on the radiance the image holds before
  // the finishing and the chain touch it; the finishing's passes, which read it, then the chain's.
  const image = resolved?.color ?? lit
  const exposure = exposureSettings(rt)
  encodeExposure(rt, device, encoder, image, source.drawn, raw, exposure, preExposureOf(rt).now)
  const post = encodeFinish(rt, device, encoder, image, source.drawn, raw, exposure)
  const effects = encodeEffects(rt, device, encoder, resolved, post, source.drawn)
  let composed =
    asIs && blendShare && !accumulated
      ? composedImage(effects?.color ?? lit, blendShare.view, effects?.glow)
      : effects
  const finish = finishedGroup(rt, post, effects?.glow)
  if (finish)
    composed = composedImage(composed?.color ?? lit, composed?.share, composed?.glow, finish)
  return composed
}

/** The swap-chain view the image is composed onto, none when it composes offscreen: a capture, a
 *  diagnostic variant, a guide (`guided`) or a view placed at a canvas rectangle composes
 *  offscreen; an image withheld — till the view has loaded, or while a load blocks on slow
 *  streaming — composes offscreen and is never shown (`../loop/firstImage.ts`). */
function presentationOf(rt: WebgpuPagesRuntime, guided: boolean) {
  const { gpu, run, capture } = rt
  return capture.capturing ||
    guided ||
    !!rt.views.active.rect ||
    run.imageWithheld ||
    composesOffscreen(rt.context.diagnosticGpuVariant)
    ? undefined
    : gpu.presenter?.targetView(...gpu.displaySize)
}

/** What a capture's view turns off or forces (`ViewOverrides`) ahead of the lighting: the surfaces
 *  rewritten before any light reads them, the lights' buffer cleared of its lights; the main view
 *  does neither. Returns the overrides the rest of the image reads. */
function encodeViewOverrides(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  surfaces: SurfaceBuffer,
) {
  const overrides = rt.views.active.overrides
  if (rewritesSurfaces(overrides)) encodeSurfaceRewrite(device, encoder, surfaces, overrides)
  if (!overrides.lighting) encodeUnlitLights(rt, device, encoder)
  return overrides
}

/**
 * The indirect light of the image, each pass where its view's overrides leave it: what every surface
 * reflects, traced here — the opaque ones, the resolve's input, and the transparents' front one,
 * which the translucent layers read; behind it, they read the same view inline —; the pixels'
 * indirect light, from the probes placed on the image, after the reflections, which made the lit
 * image of the last image readable; the ambient occlusion, where no screen probes light the pixels
 * (or, asked, over theirs), from the depth pyramid this image built; the sky light's occlusion by the distance fields,
 * where no screen probes light the pixels (`encodeSkyOcclusion`). The lighting reads what they leave.
 */
function encodeIndirectLight(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  overrides: ViewOverrides,
) {
  encodeSkyOcclusion(rt, encoder, cam)
  if (reflects(overrides)) encodeReflections(rt, encoder)
  if (!overrides.lighting) return
  encodeScreenProbes(rt, encoder)
  encodeAmbientOcclusion(rt, encoder, cam)
}

/** The image of a view that runs no effect (`ViewOverrides.post`): its lit image is its output,
 *  handed to the reader it names ahead of the radiance turn; nothing is composed nor presented. */
function finishUncomposed(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  overrides: ViewOverrides,
  filter: ReturnType<typeof beginDisplayFilter>,
) {
  const { gpu } = rt
  overrides.readLit?.(encoder, gpu.hdrView!, gpu.targetSize, gpu.allocatedSize)
  if (filter) filter.active = false
  finishVsmFrame(rt, encoder)
  adoptRadianceImage(gpu)
  return false
}

/** Lights the surfaces into the HDR target, draws the forward transparents over it, and composes the
 *  display image at its size; returns whether it landed on the presented swap-chain view. */
export function encodeSurfaceLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, run } = rt,
    clear = clearValueOf(run.clearColor)
  if (!gpu.surfaces || !gpu.deferred || !gpu.hdrView || !gpu.depthView || !gpu.displayView)
    throw new Error('DEFERRED_UNAVAILABLE')
  const { deformation } = rt.vis
  poseHost.pool = rt.vis.concatPos
  poseHost.deformation = deformation
  poseHost.revision = deformation?.frame.revision ?? 0
  run.gpuSelection?.proxyPose(encoder, poseHost)
  poseHost.pool = poseHost.deformation = undefined
  const overrides = encodeViewOverrides(rt, device, encoder, gpu.surfaces)
  // The motion of every texel, once, before any pass reads it: the indirect light, the temporal pass
  // and the motion blur (`../../post/taa/velocityFrame.ts`).
  encodeVelocity(rt, device, encoder, cam)
  // A view the resolve paints, and a lit view that measures, are shown in raw values; a view of
  // the lit image otherwise goes through the display chain as the lit image does (`showsRaw`).
  const [width, height] = gpu.targetSize,
    raw = showsRaw(run.diagnostic)
  invertMatrix4(inverseViewProj, viewProj)
  // The transparents are selected and ordered first; light lists encode before resolve, its inputs —
  // every lighting resource the blend group names made with them.
  const blendRuns = prepareBlend(rt, encoder)
  const direct = encodeDirectLights(rt, device, encoder, cam, viewProj)
  // The air's tables and haze volume, which the lighting reads through the light buffer just pushed.
  requestSkyAir(rt, device)
  // The clouds' shadow maps, which the air, the fog and the surfaces read.
  encodeCloudShadow(rt, device, encoder, cam)
  const air = encodeAtmosphere(rt, device, encoder, cam, viewProj, inverseViewProj)
  for (let i = 0; i < 4; i++) cameraWorldArray[i] = cam.viewPoint[i]
  // The transparents bound for the image, and their front pass drawn: their nearest depth and the
  // surface the trace reads.
  const blendKey = blendRuns ? bindBlend(rt, device) : undefined
  if (blendKey) encodeFrontPass(rt, device, encoder)
  // The depth's pyramid, complete with this image's transparents: the contact rays of the lights —
  // the shadows' projection, held until now — and the reflections march it.
  encodeDepthPyramid(rt, encoder)
  encodeHeldVsmProjection(rt)
  // The fog's volume, built over the light lists and the sun's shadow maps just made, and the opaque
  // depth: the resolve, the blends and the sky read it.
  encodeFogVolume(rt, device, encoder, cam, direct)
  // The light shafts' occlusion, which the resolve multiplies the fog's inscattering by.
  encodeLightShaftOcclusion(rt, device, encoder, cam)
  // The sky light's capture, on the air's tables of this image, before the passes that read the light.
  encodeSkyLight(rt, device, encoder)
  encodeIndirectLight(rt, encoder, cam, overrides)
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
  // The sky where no surface was drawn, the haze on the surfaces and the clouds over them, before the
  // transparents lie over it.
  encodeSkyAndClouds(rt, device, encoder, cam, air)
  // A see-through view's opaque background, which its edges are drawn over
  // (`../../visibility/passes/xray.ts`).
  encodeSeeThroughBackground(rt, encoder, clear)
  const blendShare = seedAsIsShare(rt, device, encoder)
  const filter = beginDisplayFilter(rt, device)
  // Bound again: the shadows' projection may have made a resource the blend group names since.
  encodeBlend(rt, device, encoder, blendKey && bindBlend(rt, device))
  if (overrides.particles) drawParticles(rt, encoder, directTiles())
  // The see-through views' edges over the lit image and its transparents
  // (`../../visibility/passes/xray.ts`).
  encodeXray(rt, device, encoder)
  // The light shafts' bloom, added onto the lit image the translucent surfaces lie over, before the
  // temporal pass and the effects read it.
  encodeLightShaftBloom(rt)
  // The lit image whole, before its resolve: the next image's reflections read it.
  if (reflects(overrides)) encodeReflectionRadiance(rt, encoder)
  if (!overrides.post) return finishUncomposed(rt, encoder, overrides, filter)
  // Composition reads the temporal result, or the lit image without accumulation.
  const asIs = readsAsIs(rt)
  const accumulated = encodeTaaPass(rt, device, encoder, cam, gpu.hdrView, asIs, blendShare)
  const composed = encodeImageChain(rt, device, encoder, cam, accumulated, blendShare, asIs, raw)
  const guided = guidesShown(rt)
  const presentation = presentationOf(rt, guided)
  // The frame-difference view composes the display image alone, then draws its difference with
  // the image before onto the canvas (`frameDifference.ts`).
  const difference = presentation && differenceOf(rt, device)
  const shown = difference ? undefined : presentation
  run.gpuDrawCalls++
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
