import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { encodeHeldVsmProjection } from '../../lighting/shadows/vsm/frame/vsmProject.ts'
import { encodeDepthPyramid, encodeReflections } from '../../lighting/reflections/frame.ts'
import { flushRadianceCache } from '../../lighting/bounce/cache/cacheFrame.ts'
import { placeScreenProbes, traceScreenProbes } from '../../lighting/bounce/screen/frame.ts'
import { encodeAmbientOcclusion } from '../../lighting/ao/frame.ts'
import { encodeFogVolume } from './encodeFogVolume.ts'
import { encodeTranslucencyVolume } from '../../lighting/translucency/frame.ts'
import { encodeTranslucencyGi } from '../../lighting/translucencyGi/frame.ts'
import { encodeSkyLight } from './encodeSkyLight.ts'
import { encodeQueuedBounce } from './encodeLights.ts'
import { encodeLocalFog, encodeLocalFogSky } from './encodeLocalFog.ts'
import { encodeSkyOcclusion } from './encodeSkyOcclusion.ts'
import { encodeSunFieldShadow, encodeWaterSunFieldShadow } from './encodeSunFieldShadow.ts'
import { encodeLightShaftOcclusion } from '../../modules/sky/lightShafts/frame.ts'
import { reflects, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

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
  // The depth's pyramid, complete with this image's transparents: the contact rays of the lights —
  // the shadows' projection, held until now — and the reflections march it.
  encodeDepthPyramid(rt, encoder)
  // The four that follow are compute passes with nothing between them: one pass, but on a frame
  // timed per pass.
  const steps = compute.begin(encoder)
  encodeHeldVsmProjection(rt, steps)
  // The lists of the local fog volumes over each tile, culled by the tile's frustum and by the pyramid
  // just built: before the fog's volume and everything that lays the fog reads them.
  encodeLocalFog(rt, device, steps)
  // The fog's volume, built over the light lists and the sun's shadow maps just made, and the opaque
  // depth: the resolve, the blends and the sky read it.
  encodeFogVolume(rt, device, steps, cam, direct)
  // The translucency lighting volume, built over the same shadow maps: the blends lit from it read it.
  encodeTranslucencyVolume(rt, device, steps, cam)
  steps.end()
  // The light shafts' occlusion, which the resolve multiplies the fog's inscattering by.
  encodeLightShaftOcclusion(rt, device, encoder, cam)
  // The sky light's occlusion by the distance fields, where no bounce lights the pixels: before the light's read uniform is
  // written (`encodeSkyLight`), which says whether the image has one.
  encodeSkyOcclusion(rt, encoder, cam)
  // The sky light's capture, on the air's tables of this image, before the passes that read the light.
  encodeSkyLight(rt, device, encoder)
  // The sky light's term in the local fog volumes, which the passes below lay over the surfaces.
  encodeLocalFogSky(rt, device, compute.begin(encoder))
  compute.end()
  // The sun's shadow past its shadow maps, traced against the distance fields, which the resolve
  // multiplies the sun's shadow by.
  encodeSunFieldShadow(rt, encoder, cam)
  // The same sun's shadow at the water's depth, for the water that keeps its sun apart.
  encodeWaterSunFieldShadow(rt, encoder, cam)
  // What every surface reflects, traced here: the opaque ones, the resolve's input, and the
  // transparents' front one, which the translucent layers read; behind it, they read the same
  // view inline. A lit view stages the reflection view even when it traces none: the probes and the translucency's light read it.
  if (!overrides.lighting) return
  encodeReflections(rt, encoder, reflects(overrides))
  // The pixels' indirect light, from the probes placed on the image: after the reflections, which made
  // the lit image of the last image readable, and before the lighting, which reads them.
  const placed = placeScreenProbes(rt, encoder)
  // The probe pass held for the placement: it marks the cells the probes just placed stand in — from the last image's, where they cast none this image —,
  // before the radiance cache's update that follows fills every cell they read.
  encodeQueuedBounce(rt, encoder, placed?.marks)
  // The probes' rays, traced over the cells just filled, and the pixels' integration of them.
  traceScreenProbes(rt, encoder, placed)
  // The world probes' radiance maps the image queued, where the screen probes made none of the update: before the lighting.
  flushRadianceCache(rt, encoder)
  // The see-through surfaces' indirect light, traced from the radiance cache just brought up to date: before the blends, which read it.
  encodeTranslucencyGi(rt, device, encoder, cam)
  // The ambient occlusion, where no global illumination is on (or, asked, over the probes' light): from the depth pyramid
  // this image built, before the lighting, which applies the texture it leaves.
  encodeAmbientOcclusion(rt, encoder, cam)
}
