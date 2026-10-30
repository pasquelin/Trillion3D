import { clipmapExtent } from '../../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import { cameraForward } from '../../../camera/forward.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { cachedLightingPreExposureOf } from '../../../post/exposure/frame.ts'
import { preExposureOf } from '../../../post/exposure/pre.ts'
import type { SkyLightReadSet } from '../../../modules/sky/skyLight/read.ts'
import { radianceCacheTraced } from '../../bounce/cache/cacheFrame.ts'
import { occlusionTraced, reservoirsTraced, screenProbesTraced } from '../../bounce/screen/cast.ts'
import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'
import { translucencyGiTraced } from '../../translucencyGi/frame.ts'
import { tracedTranslucencyTraced } from '../../reflections/translucency/stage.ts'
import { reflectionsTraced } from '../../reflections/hardware.ts'
import { hardwareRayTracing, surfaceCacheRaysOf } from '../../rays/hardwareRayTracing.ts'
import { pathTracingOn } from '../../pathTracing/enabled.ts'
import { castersTraced } from '../../manyLightsSampled/debug/casters/casters.ts'
import { rayTracedAoTraced } from '../../ao/rayTraced/rayTracedAoGate.ts'
import { skyLightTracedWanted } from '../../skyLightTraced/skyLightTracedGate.ts'
import { rayTracedShadowsTraced } from '../../shadows/rayTraced/rayTracedLights.ts'
import { lightProfileResources } from '../../lightProfile/frame.ts'
import { lightProfileStandIn } from '../../lightProfile/profileStandIn.ts'
import { cloudShadowStandIn } from '../../atmosphere/cloudShadowStandIn.ts'
import type { CloudShadowSet } from '../../atmosphere/cloudShadowRead.ts'
import { fieldSettingsOf, keptStreamingView, reachOf, surfaceHitReads } from '../frame.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import { createSurfaceLighting, encodeLighting, settleImages } from './surfaceLighting.ts'
import { beginLighting } from './beginLighting.ts'

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
    surfaceCacheRaysOf(state.settings),
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
      meshReach: reachOf(rt, state) + state.settings.surfaceCacheCardCaptureMargin,
      // The path tracer casts every ray of its view through the scene's triangles, whatever the device's hardware; so do the reservoirs, once the setting chose them over the probes, the ray traced shadows of the lights that ask for them, the ray traced ambient occlusion, the ray traced sky light, the traced translucency (its own setting is the whole gate), and the sampled lighting's shadow caster views (`sampledLightsHardwareRayTracing`).
      probes:
        pathTracingOn(rt) ||
        reservoirsTraced(rt) ||
        tracedTranslucencyTraced(rt) ||
        rayTracedShadowsTraced(rt) ||
        rayTracedAoTraced(rt) ||
        skyLightTracedWanted(rt) ||
        castersTraced(rt) ||
        (hardwareRayTracing() &&
          (radianceCacheTraced(rt) ||
            screenProbesTraced(rt) ||
            occlusionTraced(rt) ||
            reflectionsTraced(rt) ||
            translucencyGiTraced(rt, device, frame.cam))),
      image: {
        noiseFrame: noiseFrame(rt),
        eye: frame.cam.eye,
        viewProjection: frame.viewProjection,
        other: keptStreamingView(),
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
