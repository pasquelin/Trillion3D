import { encodeHeldVsmProjection } from '../../lighting/shadows/vsm/frame/vsmProject.ts'
import { encodeDepthPyramid, encodeReflections } from '../../lighting/reflections/frame.ts'
import { flushRadianceCache } from '../../lighting/bounce/cache/cacheFrame.ts'
import { encodeScreenProbes } from '../../lighting/bounce/screen/frame.ts'
import { encodeAmbientOcclusion } from '../../lighting/ao/frame.ts'
import { encodeFogVolume } from './encodeFogVolume.ts'
import { encodeSkyLight } from './encodeSkyLight.ts'
import { encodeSkyOcclusion } from './encodeSkyOcclusion.ts'
import { encodeLightShaftOcclusion } from '../../modules/sky/lightShafts/frame.ts'
import { reflects, type ViewOverrides } from '../backend/state/viewOverrides.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

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

/** The selection proxy's pose, from the deformation the image was drawn with. */
export function encodeProxyPose(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { deformation } = rt.vis
  poseHost.pool = rt.vis.concatPos
  poseHost.deformation = deformation
  poseHost.revision = deformation?.frame.revision ?? 0
  rt.run.gpuSelection?.proxyPose(encoder, poseHost)
  poseHost.pool = poseHost.deformation = undefined
}

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
  encodeHeldVsmProjection(rt)
  // The fog's volume, built over the light lists and the sun's shadow maps just made, and the opaque
  // depth: the resolve, the blends and the sky read it.
  encodeFogVolume(rt, device, encoder, cam, direct)
  // The light shafts' occlusion, which the resolve multiplies the fog's inscattering by.
  encodeLightShaftOcclusion(rt, device, encoder, cam)
  // The sky light's capture, on the air's tables of this image, before the passes that read the light.
  encodeSkyLight(rt, device, encoder)
  // The sky light's occlusion by the distance fields, where no screen probes light the pixels.
  encodeSkyOcclusion(rt, encoder, cam)
  // What every surface reflects, traced here: the opaque ones, the resolve's input, and the
  // transparents' front one, which the translucent layers read; behind it, they read the same
  // view inline.
  if (reflects(overrides)) encodeReflections(rt, encoder)
  if (!overrides.lighting) return
  // The pixels' indirect light, from the probes placed on the image: after the reflections, which made
  // the lit image of the last image readable, and before the lighting, which reads them.
  encodeScreenProbes(rt, encoder)
  // The world probes' radiance maps the image queued, where the screen probes made none of the update: before the lighting.
  flushRadianceCache(rt, encoder)
  // The ambient occlusion, where no screen probes light the pixels (or, asked, over theirs): from the depth pyramid
  // this image built, before the lighting, which applies the texture it leaves.
  encodeAmbientOcclusion(rt, encoder, cam)
}
