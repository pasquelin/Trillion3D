import type { GpuPassTimings } from '../sdk-core/index.ts';
import { DEFERRED_LIGHTING_PASS } from './deferredLighting.ts';
import { LIGHT_TILES_PASS } from './gpuLightTiles.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import type { StageAdd } from './stageProfiler.ts';

/**
 * L'étape à laquelle appartient chaque passe GPU, lue par l'étiquette que la passe porte déjà — le
 * même mécanisme que `directLightTimings`, généralisé à toute l'image. Une étiquette inconnue n'est
 * pas rangée d'office ailleurs : elle rejoint `geometry`, la seule étape qui dessine sans nom propre.
 */
const PASS_STAGES: Readonly<Record<string, string>> = Object.freeze({
  'WG DAG selection': 'selection',
  'WG draw compaction': 'selection',
  'WG HiZ pyramid': 'hiZ',
  'WG HiZ test': 'hiZ',
  'WG clear': 'geometry',
  'WG visibility primary': 'geometry',
  'WG visibility secondary': 'geometry',
  'WG small triangle binning': 'geometry',
  'WG small triangle raster': 'geometry',
  'WG hybrid visibility resolve': 'geometry',
  'WG empty surfaces': 'geometry',
  'WG material surfaces v1': 'geometry',
  'WG opaque fallback': 'geometry',
  'WG transparents': 'transparents',
  [SHADOW_PASS]: 'shadows',
  [LIGHT_TILES_PASS]: 'lightLists',
  [DEFERRED_LIGHTING_PASS]: 'lighting',
  'WG HDR composition': 'present',
  'WG HDR composition + present': 'present',
  'WG direct present': 'present',
  'WG explicit capture': 'present',
});

/** Les étapes que le moteur WebGPU sait nommer, dans l'ordre où elles se produisent. */
export const WEBGPU_STAGES = [
  'lights',
  'selection',
  'transparents',
  'residency',
  'uploads',
  'encode',
  'submit',
  'hiZ',
  'geometry',
  'coplanar',
  'shadows',
  'lightLists',
  'lighting',
  'present',
] as const;

/** Les étapes que le moteur WebGL2 sait nommer. */
export const WEBGL_STAGES = [
  'animations',
  'lights',
  'hierarchyCut',
  'selection',
  'uploads',
  'residency',
  'submit',
  'frame',
] as const;

/**
 * Ventile un relevé d'horodatage sur les étapes. Un relevé tronqué ne dépose rien : une somme
 * partielle passerait pour une mesure. Une passe sans durée utilisable ne dépose rien non plus.
 */
export function addGpuPasses(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  if (!sample || sample.truncated) return false;
  const totals = new Map<string, number>();
  for (const pass of sample.passes) {
    if (pass.gpuMs === null) continue;
    const stage = PASS_STAGES[pass.name] ?? 'geometry';
    totals.set(stage, (totals.get(stage) ?? 0) + pass.gpuMs);
  }
  for (const [stage, ms] of totals) add(stage, ms);
  return totals.size > 0;
}
