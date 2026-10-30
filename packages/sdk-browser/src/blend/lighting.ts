import { directLightResources } from '../frame/prepare/contractLight.ts'
import type { BlendLighting } from '../gpu/bind/blendBindEntries.ts'
import { vsmOrStandIns } from '../lighting/shadows/vsm/frame/vsmConsumers.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { lightFunctionResources } from '../lighting/lightFunction/frame.ts'
import { cloudVertexStandIns, translucentCloudVertex } from './cloudVertex.ts'
import { FLAGS_VIEW } from '../materials/surface/surfaceOutputs.ts'
import { translucencyVolumeView } from '../lighting/translucency/frame.ts'
import { translucencyGiSampler, translucencyGiView } from '../lighting/translucencyGi/frame.ts'
import { lightProfileResources } from '../lighting/lightProfile/frame.ts'
import { cameraStandIn, heterogeneousCameraOf } from '../lighting/heterogeneousVolumes/cameraMap.ts'
import { lightProfileStandIn } from '../lighting/lightProfile/profileStandIn.ts'
import { objectShadowReadResources } from './objectShadow/objectShadowSelf.ts'

/** Each runtime's one lighting record, rewritten by each image: the live entries read it. */
const records = new WeakMap<object, BlendLighting>()

/**
 * Lighting resources the blend pass binds: exactly those the opaque resolve just resolved,
 * and the deferred-resolve placeholders for those that do not exist yet. One resolve for both
 * passes, so the blend pass owns no light of its own (P6). `contract`: those the frame resolved.
 * The record is the runtime's own, written in place by each call. `sky`: the sky surfaces' (unlit, fog-free), drawn before the clouds and the
 * volumes of the image are made: those are the stand-ins and nothing of them is held for the image.
 */
export function blendLightResources(
  rt: WebgpuPagesRuntime,
  contract = directLightResources(rt),
  sky = false,
): BlendLighting {
  const { placeholders } = rt.gpu.deferred!
  const fog = contract.fog ?? placeholders.fog
  const vsm = vsmOrStandIns(contract.vsm, placeholders)
  // The translucent layers read the light functions where the setting says (`lightFunctionTranslucent`).
  const lightFunction =
    lightFunctionResources(rt, 'lightFunctionTranslucent') ?? placeholders.lightFunction
  const device = rt.gpu.device!,
    clouds = sky ? cloudVertexStandIns(device) : translucentCloudVertex(rt, device)
  let into = records.get(rt.blendState)
  if (!into) records.set(rt.blendState, (into = {} as BlendLighting))
  into.directLights = contract.lights!
  into.shadowData = vsm.pageTable
  into.shadowAtlas = vsm.projectionData
  into.shadowSampler = vsm.uniforms
  into.shadowPool = vsm.pool
  // What a fragment traces with past the maps: the projection's view and noise (`vsmTraceFactor`).
  into.shadowView = vsm.view
  into.shadowNoise = vsm.noise
  into.tileLights = contract.tiles ?? placeholders.tiles
  // The opaque surfaces' flags, which a translucent surface's contact shadow ray reads at the surface it hits.
  into.surfaceFlags = rt.gpu.surfaces?.views()[FLAGS_VIEW] ?? placeholders.surfaceFlags
  // The front's radiance the trace wrote (`frontLayer.ts`), a texel until a transparent reflects.
  into.frontTraced = rt.gpu.reflection!.front.views.traced
  // The fog's cubemap and volume this image built, or their stand-ins.
  into.fogCubemap = fog.cubemap
  into.fogVolume = fog.volume
  into.fogSampler = fog.sampler
  into.fogTiles = fog.tiles
  into.lightFunctionAtlas = lightFunction
  // The translucency lighting volume this image built, or the stand-in the surfaces lit from it read black from.
  into.translucencyVolume = translucencyVolumeView(rt, rt.gpu.device!)
  // The translucency global illumination volume this image built, or the stand-in the surfaces read the sky light from.
  into.translucencyGi = translucencyGiView(rt, rt.gpu.device!)
  into.translucencyGiSampler = translucencyGiSampler(rt.gpu.device!)
  // The light profiles' atlas the scene's lights name, or the stand-in a profiled light never reads.
  const profiles = lightProfileResources(rt) ?? lightProfileStandIn(rt.gpu.device!)
  into.lightProfileAtlas = profiles.view
  into.lightProfileSampler = profiles.sampler
  into.rectAtlas = profiles.rectView
  into.rectSampler = profiles.rectSampler
  // The heterogeneous volumes' camera map this image made (composited with the translucency), or the stand-in that holds nothing.
  into.volumeCamera = (!sky && heterogeneousCameraOf(rt.gpu)?.view) || cameraStandIn(device)
  // The records and table of the translucent surfaces' own shadow the depth pass made this image, or the stand-ins that shadow nothing.
  into.objectShadow = objectShadowReadResources(rt, device)
  // The clouds' shade and the cloud image the programs that read the clouds read per vertex, or
  // their stand-ins (`cloudVertex.ts`).
  into.cloudShade = clouds.shade
  into.cloudFog = clouds.fog
  return into
}
