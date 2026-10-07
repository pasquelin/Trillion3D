import { directLightResources } from '../pages/prepare/lightResources.ts'
import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

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
  return {
    directLights: contract.lights!,
    shadowData: contract.vsm?.pageTable ?? placeholders.vsmPageTable,
    shadowAtlas: contract.vsm?.projectionData ?? placeholders.vsmProjectionData,
    shadowSampler: contract.vsm?.uniforms ?? placeholders.vsmUniforms,
    // The translucent casters' transmission atlas on the transmittance layer's number.
    shadowTransmittance: contract.vsmTransmission ?? placeholders.transmittanceView,
    shadowTranslucentDepth: contract.vsm?.pool ?? placeholders.vsmPool,
    bounceGrid: contract.bounceGrid ?? placeholders.bounceGrid,
    probes: contract.probes ?? placeholders.probes,
    tileLights: contract.tiles ?? placeholders.tiles,
    proxy: contract.proxy ?? placeholders.proxy,
    surfaceCache: contract.surfaceCache ?? placeholders.surfaceCache,
  }
}
