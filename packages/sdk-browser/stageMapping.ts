import type { GpuPassTimings } from '../sdk-core/index.ts';
import { BOUNCE_PROBE_PASS } from './bounceProbeWgsl.ts';
import { DEFERRED_LIGHTING_PASS } from './deferredLighting.ts';
import { LIGHT_TILES_PASS } from './gpuLightTiles.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import type { StageAdd } from './stageProfiler.ts';

/**
 * L'étape à laquelle appartient chaque passe GPU, lue par l'étiquette que la passe porte déjà. C'est
 * l'unique lecture des étiquettes du dépôt : les durées de l'éclairage direct et le profil par étape
 * la partagent. Une étiquette inconnue n'est pas rangée d'office ailleurs : elle rejoint `geometry`,
 * la seule étape qui dessine sans nom propre.
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
  [BOUNCE_PROBE_PASS]: 'bounce',
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
  'bounce',
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
 * La durée carte graphique de chaque étape d'un relevé, en un seul parcours. `null` pour une étape
 * dont une passe n'a pas de durée utilisable : une somme partielle passerait pour une mesure. Un
 * relevé tronqué ou absent ne donne aucune étape, pour la même raison.
 */
function gpuStageTotals(sample: GpuPassTimings | null | undefined) {
  const totals = new Map<string, number | null>();
  if (!sample || sample.truncated) return totals;
  for (const pass of sample.passes) {
    const stage = PASS_STAGES[pass.name] ?? 'geometry';
    const total = totals.get(stage);
    if (total === null) continue;
    totals.set(stage, pass.gpuMs === null ? null : (total ?? 0) + pass.gpuMs);
  }
  return totals;
}

/** Ventile un relevé sur les étapes du profil : ce qui n'est pas mesuré n'y est pas déposé. */
export function addGpuPasses(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [stage, ms] of gpuStageTotals(sample)) if (ms !== null) add(stage, ms);
}

/** Les trois durées de l'éclairage direct de l'image, lues dans le même relevé par étiquette. */
export function directLightTimings(sample: GpuPassTimings | null | undefined) {
  const totals = gpuStageTotals(sample);
  return {
    gpuLightListsMs: totals.get('lightLists') ?? null,
    gpuShadowsMs: totals.get('shadows') ?? null,
    gpuLightingMs: totals.get('lighting') ?? null,
  };
}

/**
 * Dépose les bornes processeur d'une image sur leurs étapes. `null` marque une borne qui ne se
 * dépose pas : une somme, qui compterait une seconde fois ce que ses parties ont déjà déposé.
 */
export function addCpuSteps(
  stages: ReadonlyArray<string | null>,
  row: ArrayLike<number>,
  add: StageAdd,
) {
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    if (stage) add(stage, row[i]);
  }
}

/**
 * Une déclaration ordonnée des bornes processeur d'un moteur : pour chacune, le nom public et
 * l'étape du profil où elle se dépose — `null` pour une somme, qui ne se dépose pas, sans quoi elle
 * compterait une seconde fois ce que ses parties ont déjà déposé. Les noms, les étapes et les
 * indices d'écriture sortent tous de la même table : ils ne peuvent plus se désaligner en silence.
 */
export function cpuStepTable<Table extends ReadonlyArray<readonly [string, string | null]>>(
  table: Table,
): {
  names: readonly string[];
  stages: ReadonlyArray<string | null>;
  /** L'indice d'une borne dans la ligne du profil, lu par son nom et jamais écrit à la main. */
  at: Record<Table[number][0], number>;
} {
  return {
    names: table.map(([name]) => name),
    stages: table.map(([, stage]) => stage),
    // `fromEntries` ne sait pas rendre des clés littérales : le nom déclaré les porte.
    at: Object.fromEntries(table.map(([name], index) => [name, index])) as Record<
      Table[number][0],
      number
    >,
  };
}
