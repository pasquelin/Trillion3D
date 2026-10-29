import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { encodeHeldVsmProjection } from '../../lighting/shadows/vsm/frame/vsmProject.ts'
import {
  encodeDepthPyramid,
  stageReflections,
  traceReflections,
} from '../../lighting/reflections/frame.ts'
import { drawHeldVolumeMarks } from '../../blend/radianceMark.ts'
import { flushRadianceCache } from '../../lighting/bounce/cache/cacheFrame.ts'
import { encodeFieldPixels } from '../../lighting/bounce/irradianceField/cache.ts'
import { indirectSourceOf } from '../../lighting/bounce/screen/cast.ts'
import { writeIndirectWords } from '../../lighting/bounce/screen/indirectWords.ts'
import { cachedLightingPreExposureOf } from '../../post/exposure/frame.ts'
import { placeScreenProbes, traceScreenProbes } from '../../lighting/bounce/screen/frame.ts'
import { encodeAmbientOcclusion } from '../../lighting/ao/frame.ts'
import { encodeFogVolume, fogVolumeMedium } from './encodeFogVolume.ts'
import { encodeSampledVolume } from '../../lighting/manyLightsSampled/volumeFrame.ts'
import { directTiles } from './encodeLights.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { cloudShadowOf } from './encodeCloudShadow.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import { fogSettingsOf } from './fogSettings.ts'
import { encodeTranslucencyGi } from '../../lighting/translucencyGi/frame.ts'
import { writeSkyLightParams } from './encodeSkyLight.ts'
import { encodeQueuedBounce } from './encodeLights.ts'
import { encodeLocalFog, encodeLocalFogSky } from './encodeLocalFog.ts'
import { encodeSkyOcclusion } from './encodeSkyOcclusion.ts'
import { encodeCapsuleIndirectFactors } from '../../lighting/capsuleShadows/host.ts'
import { encodeLightShaftOcclusion } from '../../modules/sky/lightShafts/frame.ts'
import {
  encodeScreenSpaceIndirect,
  encodeScreenSpaceReflections,
  screenIndirectAsked,
  screenReflectionsAsked,
} from '../../lighting/screenSpaceTracing/stage.ts'
import { reflects, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { encodeBendContactShadows } from './encodeBendContact.ts'
import { readsContactView, setContactShadowView } from '../../lighting/contactShadow/frame.ts'

/** The compute passes of the pre-light step that follow one another. */
const compute = new ComputeRun()

/**
 * THE PASSES THE LIGHTING READS THE RESULTS OF, in their order, from the depth the image was drawn with and
 * the light lists (`direct`): the one place an image's pass that runs after the transparents' front pass
 * and before the lighting is added; each where the view's `overrides` leave it.
 */
export function encodePreLight(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  direct: ArrayLike<number>,
  overrides: ViewOverrides,
) {
  // What the contact shadows' rays read of the view, if a program holds them: the lit passes' or the translucent ones'.
  const { deferred } = rt.gpu
  if (deferred && readsContactView(rt)) setContactShadowView(deferred, cam)
  // The depth's pyramid, complete with this image's transparents: the contact rays of the lights —
  // the shadows' projection, held until now — and the reflections march it.
  encodeDepthPyramid(rt, encoder)
  // The screen-space contact shadow of the suns (`contactShadowMethod` 1), over the depth just complete: the lit term of a light reads it.
  encodeBendContactShadows(rt, device, encoder, cam)
  // The lists of the local fog volumes over each tile, culled by the tile's frustum and by the pyramid
  // just built: before the fog's volume and everything that lays the fog reads them.
  const steps = compute.begin(encoder)
  encodeLocalFog(rt, device, steps)
  steps.end()
  // The sky light's occlusion by the distance fields, where no bounce lights the pixels: before the light's read uniform is
  // written (`writeSkyLightParams`), which says whether the image has one.
  encodeSkyOcclusion(rt, encoder, cam)
  // The indirect capsule shadows, drawn into the buffer the indirect pass reads (R: after the diffuse indirect and the occlusion, before the direct lights).
  encodeCapsuleIndirectFactors(rt, encoder, cam)
  // The light's read uniform, written again with this image's occlusion: the capture and a first write were made on this image's air before the surface cards (`encodeDirectLights`).
  writeSkyLightParams(rt, device)
  // The sky light's term in the local fog volumes, which the passes below lay over the surfaces.
  encodeLocalFogSky(rt, device, compute.begin(encoder))
  compute.end()
  // What every surface reflects, and the light the pixels receive from the probes, where the view is lit.
  if (overrides.lighting) encodeIndirectLight(rt, device, encoder, cam, overrides)
  // The fog's volume, built over the light lists and the sun's shadow maps just made, the opaque depth and the global illumination volume
  // of the see-through surfaces (`encodeTranslucencyGi`; its cells take that volume's light): the resolve, the blends and the sky read it.
  // The sampled lighting of the volumes (the fog's, shared by the translucency volume where it holds), before the fog is built and apart from it.
  const volumeCells = directTiles()
  encodeSampledVolume(rt, device, encoder, cam, fogVolumeMedium(rt), {
    lightCells: [volumeCells[1]!, volumeCells[2]!],
    preExposure: preExposureOf(rt).now,
    cloudShadow: cloudShadowOf(rt) ?? cloudShadowStandIn(device),
    lampSoftening: fogSettingsOf(rt).volumetricFogLampSoftening,
  })
  encodeFogVolume(rt, device, compute.begin(encoder), cam, direct)
  compute.end()
  // The light shafts' occlusion, which the resolve multiplies the fog's inscattering by: its mask's slots are written into the
  // fog's view block, so after the volume's block is.
  encodeLightShaftOcclusion(rt, device, encoder, cam)
  // The shadow of each direct light, projected per light once the indirect light is composed and just before the light itself is
  // lit, as the reference does. Nothing before reads the result: the resolve alone does.
  const projection = compute.begin(encoder)
  encodeHeldVsmProjection(rt, projection)
  projection.end()
}

/**
 * The pixels' indirect light where the screen probes gather none (`indirectSourceOf`): the irradiance field's gather over the maps just made, or the screen's own indirect light traced
 * from the last lit image, each written by the one writer of the lighting's words (`writeIndirectWords`) — never both, never with the probes' own.
 */
function encodeIndirectWords(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const source = indirectSourceOf(rt)
  if (source === 'field') return encodeFieldPixels(rt, device, encoder)
  if (source !== 'screen' || !screenIndirectAsked(rt, true)) return
  const out = encodeScreenSpaceIndirect(rt, device, encoder, cam)
  writeIndirectWords(rt, device, encoder, {
    light: out.diffuse,
    rough: out.diffuse,
    open: out.occlusion,
    reduction: out.ratio,
    alphaAnswers: false,
    openTexture: true,
    openReduction: 0,
    openBent: false,
    appliesOcclusion: false,
    // The light is the held image's, divided by its pre-exposure: this image's lighting is written under its own.
    exposure: cachedLightingPreExposureOf(rt),
  })
}

/**
 * The pixels' indirect light, in its order, then what every surface reflects, traced here: the opaque ones, the resolve's
 * input, and the transparents' front one, which the translucent layers read; behind it, they read the same view inline. A
 * lit view stages the reflection view even when it traces none, before the probes: they and the translucency's light read it.
 */
function encodeIndirectLight(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  overrides: ViewOverrides,
) {
  const reflections = stageReflections(rt, reflects(overrides))
  // The pixels' indirect light, from the probes placed on the image: after the reflection view is staged, and before the lighting, which reads them.
  const placed = placeScreenProbes(rt, encoder)
  // The probe pass held for the placement: it marks the cells the probes just placed stand in — from the last image's, where they cast none this image —,
  // before the radiance cache's update that follows fills every cell they read.
  encodeQueuedBounce(rt, encoder, placed?.marks)
  // The translucency volume's marks no pass drew with the radiance cache's: the reference's mark pass runs when only the volume is marked too.
  drawHeldVolumeMarks(rt, device, encoder)
  // The probes' rays, traced over the cells just filled, and the pixels' integration of them.
  traceScreenProbes(rt, encoder, placed)
  // The world probes' radiance maps the image queued, where the screen probes made none of the update: before the lighting.
  flushRadianceCache(rt, encoder)
  // The light of the sources other than the probes (the irradiance field's gather, the screen's own indirect light), written as the one set of words the lighting reads.
  encodeIndirectWords(rt, device, encoder, cam)
  // The see-through surfaces' indirect light, traced from the radiance cache just brought up to date: before the blends, which read it.
  encodeTranslucencyGi(rt, device, encoder, cam)
  // The reflections, traced after the probes: they read the vectors the probes made of this image, and the probes' light, which they take the place of past the rays.
  // Where the view's method is the screen's, the rays march the depth and read the last lit image, in the place of the scene's trace.
  if (screenReflectionsAsked(rt, reflects(overrides), !!reflections))
    encodeScreenSpaceReflections(rt, device, encoder, cam)
  else traceReflections(rt, encoder, reflections)
  // The ambient occlusion, where no global illumination is on (or, asked, over the probes' light): from the depth pyramid
  // this image built, before the lighting, which applies the texture it leaves.
  encodeAmbientOcclusion(rt, encoder, cam)
}
