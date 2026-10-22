import { directLightResources } from '../frame/prepare/contractLight.ts'
import type { BlendLighting } from '../gpu/bind/blendBindEntries.ts'
import { vsmOrStandIns } from '../lighting/shadows/vsm/frame/vsmConsumers.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { lightFunctionResources } from '../lighting/lightFunction/frame.ts'

/**
 * Lighting resources the blend pass binds: exactly those the opaque resolve just resolved,
 * and the deferred-resolve placeholders for those that do not exist yet. One resolve for both
 * passes, so the blend pass owns no light of its own (P6). `contract`: those the frame resolved.
 */
export function blendLightResources(
  rt: WebgpuPagesRuntime,
  contract = directLightResources(rt),
): BlendLighting {
  const { placeholders } = rt.gpu.deferred!
  const fog = contract.fog ?? placeholders.fog
  const vsm = vsmOrStandIns(contract.vsm, placeholders)
  // The translucent layers read the light functions where the setting says (`lightFunctionTranslucent`).
  const lightFunction =
    lightFunctionResources(rt, 'lightFunctionTranslucent') ?? placeholders.lightFunction
  return {
    directLights: contract.lights!,
    shadowData: vsm.pageTable,
    shadowAtlas: vsm.projectionData,
    shadowSampler: vsm.uniforms,
    // The translucent casters' transmission atlas on the transmittance layer's number.
    shadowTransmittance: contract.vsmTransmission ?? placeholders.transmittanceView,
    shadowPool: vsm.pool,
    // What a fragment traces with past the maps: the projection's view and noise (`vsmTraceFactor`).
    shadowView: vsm.view,
    shadowNoise: vsm.noise,
    bounceGrid: contract.bounceGrid ?? placeholders.bounceGrid,
    probes: contract.probes ?? placeholders.probes,
    tileLights: contract.tiles ?? placeholders.tiles,
    // The front's radiance the trace wrote (`frontLayer.ts`), a texel until a transparent reflects.
    frontTraced: rt.gpu.reflection!.front.views.traced,
    // The fog's cubemap and volume this image built, or their stand-ins.
    fogCubemap: fog.cubemap,
    fogVolume: fog.volume,
    fogSampler: fog.sampler,
    lightFunctionAtlas: lightFunction,
  }
}
