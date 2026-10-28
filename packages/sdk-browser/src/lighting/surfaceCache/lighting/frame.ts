import { clipmapExtent } from '../../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { cameraForward } from '../../../camera/forward.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { cachedLightingPreExposureOf } from '../../../post/exposure/frame.ts'
import { preExposureOf } from '../../../post/exposure/pre.ts'
import type { SkyLightReadSet } from '../../../modules/sky/skyLight/read.ts'
import { radianceCacheTraced } from '../../bounce/cache/cacheFrame.ts'
import { screenProbesTraced } from '../../bounce/screen/cast.ts'
import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'
import { reflectionsTraced } from '../../reflections/hardware.ts'
import { lightProfileResources } from '../../lightProfile/frame.ts'
import { lightProfileStandIn } from '../../lightProfile/profileStandIn.ts'
import { cloudShadowStandIn } from '../../atmosphere/cloudShadowStandIn.ts'
import type { CloudShadowSet } from '../../atmosphere/cloudShadowRead.ts'
import { fieldSettingsOf, surfaceHitReads } from '../frame.ts'
import { stochasticPhase } from '../../../post/taa/frameState.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import {
  createSurfaceLighting,
  encodeLighting,
  settleImages,
  type SurfaceLightingState,
} from './surfaceLighting.ts'
import { lightInputsReady } from '../../lightInputsReady.ts'

/**
 * THE SURFACE CACHE'S LIGHTING IN THE FRAME: after the image's update of the cache (`../frame.ts`), the lights in their buffer
 * and the light functions' atlas encoded, before the bounce, the light of the cards' texels is brought up to date
 * (`surfaceLighting.ts`) from what the frame holds of the lights, the sky, the clouds' shade and the global distance field,
 * so that every ray that reads the cache next finds its final light. An image that did not update the cache, or whose
 * cache is not made, lights nothing; one that lights leaves the frame busy while the light settles.
 */

/** What the frame gives the lighting: the camera, the view's matrix and exposure, the sky, the clouds' shade, the light functions. */
interface SurfaceLightingFrame {
  readonly cam: EngineCamera
  readonly viewProjection: ArrayLike<number>
  /** The view's pre-exposure, which the rays' intensity is held relative to. */
  readonly viewPreExposure: number
  readonly sky: SkyLightReadSet
  readonly cloudShadow: CloudShadowSet
  readonly lightFunction: GPUTextureView
}

/**
 * Whether the lighting has begun. It does not begin before its inputs: with the shadows unlanded or the textures coarse, what it lit — and its radiosity remembered over many images —
 * would keep a residue of the instant they came. The frame stays drawn meanwhile (the cache is busy); begun, it follows the inputs as they change.
 */
export function beginLighting(rt: WebgpuPagesRuntime, lighting: SurfaceLightingState) {
  if (!lighting.begun && lightInputsReady(rt)) {
    lighting.begun = true
    lighting.begunAt = rt.run.frame
    lighting.begunSample = stochasticPhase(rt.gpu.temporal?.frame)
    lighting.begunFeedback = rt.surfaceCache?.cache?.feedbackFrame ?? 0
  }
  return lighting.begun
}

/** Lights the surface cache for this image on `encoder`. */
export function lightSurfaceCache(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  frame: SurfaceLightingFrame,
) {
  const state = rt.surfaceCache
  const { lights } = rt
  // The cache follows the main view alone, as its update does.
  if (rt.views.active !== rt.views.main || !state?.updated || !state.atlases || !lights.buffer)
    return
  const lighting = (state.lighting ??= createSurfaceLighting())
  // Pages that were captured or copied this image have no light yet: the lighting settles from there (whether or not it lights this image).
  if (state.metrics && state.metrics.captured + state.metrics.copied > 0)
    lighting.settle = settleImages(state.settings)
  if (!beginLighting(rt, lighting)) {
    state.busy = true
    return
  }
  const field = fieldSettingsOf(rt, state)
  const outcome = encodeLighting(
    lighting,
    rt,
    device,
    encoder,
    state.cache,
    state.settings,
    state.atlases,
    state.tables,
    {
      lights: lights.buffer,
      sky: frame.sky,
      cloudShadow: state.settings.surfaceCacheDirectLightingCloudTransmittance
        ? frame.cloudShadow
        : cloudShadowStandIn(device),
      lightFunction: frame.lightFunction,
      lightProfile: lightProfileResources(rt) ?? lightProfileStandIn(device),
      ...surfaceHitReads(rt, device),
      feedback: state.feedback.buffer,
      direction: cameraForward<[number, number, number]>([0, 0, 0], frame.cam.world),
      transportEpoch: lights.store.transportEpoch,
      probes: radianceCacheTraced(rt) || screenProbesTraced(rt) || reflectionsTraced(rt),
      image: {
        noiseFrame: noiseFrame(rt),
        eye: frame.cam.eye,
        viewProjection: frame.viewProjection,
        preExposure: cachedLightingPreExposureOf(rt),
        exposure: preExposureOf(rt).exposure,
        viewPreExposure: frame.viewPreExposure,
        firstClipmapExtent: clipmapExtent(field, 0),
        maxTraceDistance: screenProbeSettingsOf(rt).values.screenProbeMaxTraceDistance,
      },
    },
  )
  // The frame is not held while the light is still reaching the pages, nor while the lighting waits for its programs.
  state.busy = state.busy || outcome === 'waiting' || (outcome === 'lit' && lighting.settle > 0)
}
