import type { GpuPassTimings } from '../sdk-core/index.ts';
import { DEFERRED_LIGHTING_PASS } from './deferredLighting.ts';
import { LIGHT_TILES_PASS } from './gpuLightTiles.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';

/**
 * La durée GPU d'une passe nommée dans le dernier relevé d'horodatage. `null` dès que l'appareil
 * n'horodate pas, que le relevé est tronqué, ou que la passe n'a pas eu lieu dans l'image relevée —
 * jamais un zéro qui ferait croire à une mesure. La valeur décrit l'image de `sample.frame`.
 */
function gpuPassMsByName(sample: GpuPassTimings | null | undefined, name: string) {
  if (!sample || sample.truncated) return null;
  let total: number | null = null;
  for (const pass of sample.passes) {
    if (pass.name !== name) continue;
    if (pass.gpuMs === null) return null;
    total = (total ?? 0) + pass.gpuMs;
  }
  return total;
}

/** Les trois durées de l'éclairage direct, lues par étiquette dans le relevé de l'image. */
export function directLightTimings(sample: GpuPassTimings | null | undefined) {
  return {
    gpuLightListsMs: gpuPassMsByName(sample, LIGHT_TILES_PASS),
    gpuShadowsMs: gpuPassMsByName(sample, SHADOW_PASS),
    gpuLightingMs: gpuPassMsByName(sample, DEFERRED_LIGHTING_PASS),
  };
}
