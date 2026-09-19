import { directLightResources } from './webgpuPagesLightResources.ts';
import type { BlendLighting } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Lighting resources the blend pass binds: exactly those the opaque resolve just resolved,
 * and the deferred-resolve placeholders for those that do not exist yet. One resolve for both
 * passes, so the blend pass owns no light of its own (P6).
 */
export function blendLightResources(rt: WebgpuPagesRuntime): BlendLighting {
  const { placeholders } = rt.gpu.deferred!,
    contract = directLightResources(rt);
  return {
    directLights: rt.lights.buffer!,
    shadowSlices: contract.slices ?? placeholders.slices,
    shadowAtlas: contract.atlas ?? placeholders.atlasView,
    shadowSampler: placeholders.sampler,
    bounceGrid: contract.bounceGrid ?? placeholders.bounceGrid,
    probes: contract.probes ?? placeholders.probes,
    tileLights: contract.tiles ?? placeholders.tiles,
    proxy: contract.proxy ?? placeholders.proxy,
  };
}

/** True when two successive resolves yielded exactly the same resources. */
export function sameLighting(previous: BlendLighting | undefined, current: BlendLighting) {
  return (
    !!previous &&
    previous.directLights === current.directLights &&
    previous.shadowSlices === current.shadowSlices &&
    previous.shadowAtlas === current.shadowAtlas &&
    previous.shadowSampler === current.shadowSampler &&
    previous.bounceGrid === current.bounceGrid &&
    previous.probes === current.probes &&
    previous.tileLights === current.tileLights &&
    previous.proxy === current.proxy
  );
}
