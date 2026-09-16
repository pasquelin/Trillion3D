import { directLightResources } from './webgpuPagesLightResources.ts';
import type { BlendLighting } from './webgpuBindEntries.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Les ressources d'éclairage que la passe de mélange lie : exactement celles que la résolution
 * opaque vient de résoudre, et les remplaçants de la résolution différée pour celles qui n'existent
 * pas encore. Une seule résolution pour les deux passes, donc aucune lumière propre au mélange (P6).
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

/** Vrai quand deux résolutions successives ont donné exactement les mêmes ressources. */
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
