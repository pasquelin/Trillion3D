import { summarize } from './stats.ts';

/**
 * Le profil par étape d'une image : où passe le temps, côté processeur et côté carte graphique.
 * Les deux colonnes ne sont JAMAIS additionnées — elles décrivent deux machines qui travaillent en
 * même temps. `null` veut dire « non mesuré » et ne vaut pas zéro : une étape qui n'a pas eu lieu,
 * un appareil sans horodatage et un relevé tronqué donnent tous `null`, jamais `0`.
 */
export type StageQuantiles = { p50: number; p95: number } | null;

/** Une ligne du profil : une étape, sa durée processeur et sa durée carte graphique. */
export interface StageProfileEntry {
  stage: string;
  label: string;
  cpuMs: StageQuantiles;
  gpuMs: StageQuantiles;
  /** Pourquoi une colonne vaut `null`, quand la raison est connue. */
  cpuReason?: string;
  gpuReason?: string;
  /** Compteurs propres a l'etape (faces d'ombre redessinees, appels de dessin d'ombre...). */
  counts?: Readonly<Record<string, number>>;
}

export type GpuTimingMethod = 'timestamp-query' | 'EXT_disjoint_timer_query_webgl2';

/**
 * Le profil complet, sur une fenêtre glissante d'images. `gpuImageMs` est l'enveloppe de l'image
 * côté carte graphique : du début de sa première passe à la fin de sa dernière. Les durées par étape
 * ne s'y additionnent PAS — un appareil qui fait se chevaucher deux passes les compte deux fois dans
 * une somme, jamais dans l'enveloppe. C'est aussi la seule mesure d'un moteur WebGL2, qui ne sait pas
 * découper une image en passes.
 */
export interface StageProfile {
  version: 1;
  enabled: boolean;
  backend: string;
  /** Images processeur et relevés carte graphique réellement retenus par la fenêtre. */
  cpuFrames: number;
  gpuSamples: number;
  windowFrames: number;
  gpuMethod: GpuTimingMethod | null;
  gpuReason: string | null;
  gpuImageMs: StageQuantiles;
  /** Coût processeur du profil lui-même, par image. C'est ce qu'il faut retrancher pour être juste. */
  overheadMs: StageQuantiles;
  stages: StageProfileEntry[];
}

/** Les étapes nommables d'une image, dans l'ordre où elles se produisent. */
export const STAGE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  animations: 'Animations et transformations',
  lights: 'Éclairage : préparation des listes et des ombres',
  hierarchyCut: 'Coupe hiérarchique',
  selection: 'Sélection et visibilité',
  transparents: 'Transparents',
  residency: 'Admission et file de résidence',
  uploads: 'Téléversements',
  encode: 'Encodage des commandes',
  submit: 'Soumission',
  hiZ: 'Hi-Z (occultation)',
  geometry: 'Géométrie',
  coplanar: 'Couches coplanaires',
  shadows: 'Ombres',
  lightLists: 'Listes de lampes',
  lighting: 'Éclairage (résolution)',
  present: 'Présentation',
  frame: 'Image entière',
});

export const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;

/** p50 et p95 d'une série, ou `null` si elle est vide : rien n'est déduit d'une série absente. */
export function stageQuantiles(values: readonly number[]): StageQuantiles {
  const summary = summarize(values);
  return summary ? { p50: summary.p50, p95: summary.p95 } : null;
}

/** Le profil d'un moteur qui n'en tient pas : tout est « non mesuré », rien ne vaut zéro. */
export function disabledStageProfile(backend: string, reason: string): StageProfile {
  return {
    version: 1,
    enabled: false,
    backend,
    cpuFrames: 0,
    gpuSamples: 0,
    windowFrames: 0,
    gpuMethod: null,
    gpuReason: reason,
    gpuImageMs: null,
    overheadMs: null,
    stages: [],
  };
}
