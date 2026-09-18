import type { GpuPassTimings } from '../sdk-core/index.ts';
import { BOUNCE_PROBE_PASS } from './bounceProbeWgsl.ts';
import { BOUNCE_SURFACE_PASS } from './bounceSurfaceWgsl.ts';
import { DEFERRED_LIGHTING_PASS } from './deferredLighting.ts';
import { LIGHT_TILES_PASS } from './gpuLightTiles.ts';
import { REST_COMPACT_PASS } from './gpuRestCompact.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import type { StageAdd } from './stageProfiler.ts';

/**
 * Les deux blocs d'une image que l'on sait mettre en regard d'un profil publié, et rien d'autre.
 * `visibility` est la construction du tampon de visibilité : sélection, partition, Hi-Z et raster.
 * `materials` est l'écriture des surfaces depuis ce tampon. Tout le reste est `other` : ombres,
 * listes de lampes, rebond, transparents, éclairage différé, présentation, et le chemin de repli qui
 * ne passe pas par le tampon — ranger l'un de ceux-là dans un bloc gonflerait une comparaison au
 * lieu de la servir, donc ils restent dehors ET nommés, chaque passe gardant sa durée.
 */
export type GpuPassBlock = 'visibility' | 'materials' | 'other';

/**
 * L'étape du profil et le bloc de comparaison de chaque passe GPU, lus par l'étiquette que la passe
 * porte déjà. C'est l'unique lecture des étiquettes du dépôt : les durées de l'éclairage direct, le
 * profil par étape et les blocs la partagent. Une étiquette inconnue rejoint `geometry`, la seule
 * étape qui dessine sans nom propre, et `other`, pour qu'une passe nouvelle n'aille pas grossir en
 * silence un bloc comparé.
 */
const PASSES: Readonly<Record<string, readonly [stage: string, block: GpuPassBlock]>> =
  Object.freeze({
    'WG DAG selection': ['selection', 'visibility'],
    'WG partition': ['partition', 'visibility'],
    'WG draw compaction': ['selection', 'visibility'],
    [REST_COMPACT_PASS]: ['geometry', 'other'],
    'WG HiZ pyramid': ['hiZ', 'visibility'],
    'WG HiZ test': ['hiZ', 'visibility'],
    'WG clear': ['geometry', 'visibility'],
    'WG visibility primary': ['geometry', 'visibility'],
    'WG visibility secondary': ['geometry', 'visibility'],
    'WG small triangle binning': ['geometry', 'visibility'],
    'WG small triangle raster': ['geometry', 'visibility'],
    'WG hybrid visibility resolve': ['geometry', 'visibility'],
    'WG empty surfaces': ['geometry', 'materials'],
    'WG material surfaces v1': ['geometry', 'materials'],
    'WG opaque fallback': ['geometry', 'other'],
    'WG transparents': ['transparents', 'other'],
    'WG transmission': ['transparents', 'other'],
    'WG transparent compaction': ['transparents', 'other'],
    [SHADOW_PASS]: ['shadows', 'other'],
    'WG shadow cull': ['shadows', 'other'],
    [LIGHT_TILES_PASS]: ['lightLists', 'other'],
    [BOUNCE_SURFACE_PASS]: ['bounce', 'other'],
    [BOUNCE_PROBE_PASS]: ['bounce', 'other'],
    [DEFERRED_LIGHTING_PASS]: ['lighting', 'other'],
    'WG HDR composition': ['present', 'other'],
    'WG HDR composition + present': ['present', 'other'],
    'WG direct present': ['present', 'other'],
    'WG explicit capture': ['present', 'other'],
  });

/** L'étape d'une passe, par son étiquette. Inconnue vaut `geometry`. */
const gpuPassStageOf = (name: string) => PASSES[name]?.[0] ?? 'geometry';
/** Le bloc d'une passe, par son étiquette. Inconnue vaut `other`. */
export const gpuPassBlockOf = (name: string): GpuPassBlock => PASSES[name]?.[1] ?? 'other';

/** Les étapes que le moteur WebGPU sait nommer, dans l'ordre où elles se produisent. */
export const WEBGPU_STAGES = [
  'animations',
  'lights',
  'cutAdoption',
  'selection',
  'transparents',
  'residency',
  'hostPages',
  'uploads',
  'textures',
  'partition',
  'encode',
  'submit',
  'hiZ',
  'geometry',
  'coplanar',
  'shadows',
  'sunFarShadows',
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
 * La durée carte graphique d'un relevé par groupe de passes, en un seul parcours, `classify`
 * nommant le groupe de chaque passe. `null` pour un groupe dont une passe n'a pas de durée
 * utilisable : une somme partielle passerait pour une mesure. Un relevé tronqué ou absent ne donne
 * aucun groupe, pour la même raison.
 */
export function gpuTotalsBy<Group extends string>(
  sample: GpuPassTimings | null | undefined,
  classify: (name: string) => Group,
) {
  const totals = new Map<Group, number | null>();
  if (!sample || sample.truncated) return totals;
  for (const pass of sample.passes) {
    const group = classify(pass.name);
    const total = totals.get(group);
    if (total === null) continue;
    totals.set(group, pass.gpuMs === null ? null : (total ?? 0) + pass.gpuMs);
  }
  return totals;
}

/** La durée carte graphique de chaque étape du profil. */
const gpuStageTotals = (sample: GpuPassTimings | null | undefined) =>
  gpuTotalsBy(sample, gpuPassStageOf);

/** Ventile un relevé sur les étapes du profil : ce qui n'est pas mesuré n'y est pas déposé. */
export function addGpuPasses(sample: GpuPassTimings | null | undefined, add: StageAdd) {
  for (const [stage, ms] of gpuStageTotals(sample)) if (ms !== null) add(stage, ms);
}

/**
 * La durée carte graphique de l'étape « Rebond » d'un relevé, ou `null` : c'est la mesure que le
 * budget en millisecondes asservit. Une étape absente, un relevé tronqué ou un appareil sans
 * horodatage rendent `null`, et l'asservissement ne bouge pas plutôt que de suivre un zéro.
 */
export function bounceGpuMs(sample: GpuPassTimings | null | undefined) {
  return gpuStageTotals(sample).get('bounce') ?? null;
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
