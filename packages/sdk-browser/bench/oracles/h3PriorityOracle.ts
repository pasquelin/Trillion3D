/**
 * Oracle du point H3-2 : `createTexturePriority` de `webgpuTexturePriority.ts` tel qu'il était avant
 * le lot, recopié ligne à ligne, et les coupes tirées qui l'opposent au module livré. Le banc et le
 * test d'équivalence le lisent tous les deux.
 */
import type * as THREE from 'three';
import type { TextureJob } from '../../webgpuAtlasJobs.ts';
import { createTexturePriority, type MaterialLayerIndex } from '../../webgpuTexturePriority.ts';

type PriorityJob = Pick<TextureJob, 'kind' | 'slot' | 'stage' | 'nextRow'>;
type PriorityInputs = {
  index: MaterialLayerIndex | undefined;
  requested: readonly { material: never; triangles: number }[];
  blend: readonly { material: never; count: number }[];
};

/** Avant le lot : deux tableaux JavaScript agrandis d'une case par couche, à chaque `push`. */
export function referenceTexturePriority(inputs: () => PriorityInputs) {
  const colorWeights: number[] = [];
  const dataWeights: number[] = [];
  const bump = (weights: number[], layers: readonly number[], triangles: number) => {
    for (const layer of layers) {
      while (weights.length <= layer) weights.push(0);
      weights[layer] += triangles;
    }
  };
  const addWeight = (
    layers: { color: readonly number[]; data: readonly number[] } | undefined,
    triangles: number,
  ) => {
    if (!layers) return;
    bump(colorWeights, layers.color, triangles);
    bump(dataWeights, layers.data, triangles);
  };
  const weightOf = (job: PriorityJob) =>
    (job.kind === 'color' ? colorWeights : dataWeights)[job.slot] ?? 0;
  const rank = (job: PriorityJob) => (job.kind === 'color' ? 0 : 1);
  const order = (jobs: PriorityJob[]) => {
    if (jobs.length < 2) return;
    const { index, requested, blend } = inputs();
    colorWeights.fill(0);
    dataWeights.fill(0);
    if (index) {
      for (const page of requested) addWeight(index.get(page.material), page.triangles);
      for (const item of blend) addWeight(index.get(item.material), item.count / 3);
    }
    jobs.sort(
      (a, b) =>
        a.stage - b.stage ||
        rank(a) - rank(b) ||
        weightOf(b) - weightOf(a) ||
        (b.nextRow ? 1 : 0) - (a.nextRow ? 1 : 0),
    );
  };
  return { order };
}

/** Un travail de la file ; seuls `kind`, `slot`, `stage` et `nextRow` pèsent sur l'ordre. */
export function travail(kind: TextureJob['kind'], slot: number, stage: number, nextRow: number) {
  return {
    kind,
    slot,
    classIndex: 0,
    layer: slot,
    level: 0,
    stage,
    bytes: 4,
    rows: 1,
    bytesPerRow: 4,
    nextRow,
    failures: 0,
    uploadRows: () => {},
  } as TextureJob;
}

export type Coupe = {
  materiaux: number;
  couches: number;
  pages: number;
  transparents: number;
  travaux: number;
  slots: number;
  sansIndex?: boolean;
};

/**
 * Une coupe : `materiaux` matériaux lisant chacun des couches tirées sous `couches`, `pages` pages
 * demandées au cache et `transparents` maillages mélangés, dont le poids `count / 3` n'est pas
 * entier. `slots` borne les slots des travaux, éventuellement au-delà de la dernière couche vue.
 */
export function coupe(options: Coupe, alea: () => number) {
  const index: MaterialLayerIndex = new Map();
  const liste: THREE.Material[] = [];
  for (let i = 0; i < options.materiaux; i++) {
    const material = { id: i } as unknown as THREE.Material;
    index.set(material, {
      color: [Math.floor(alea() * options.couches), Math.floor(alea() * options.couches)],
      data: [Math.floor(alea() * options.couches), Math.floor(alea() * options.couches)],
    });
    liste.push(material);
  }
  const pick = () => liste[Math.floor(alea() * options.materiaux)];
  const requested = Array.from({ length: options.pages }, () => ({
    material: pick(),
    triangles: 1 + Math.floor(alea() * 4000),
  }));
  const blend = Array.from({ length: options.transparents }, () => ({
    material: pick(),
    count: 1 + Math.floor(alea() * 9000),
  }));
  const jobs = Array.from({ length: options.travaux }, () =>
    travail(
      alea() < 0.5 ? 'color' : 'data',
      Math.floor(alea() * options.slots),
      alea() < 0.4 ? 0 : 1,
      alea() < 0.3 ? 1 + Math.floor(alea() * 8) : 0,
    ),
  );
  const entrees = () =>
    ({ index: options.sansIndex ? undefined : index, requested, blend }) as never;
  return { jobs, avant: referenceTexturePriority(entrees), apres: createTexturePriority(entrees) };
}
