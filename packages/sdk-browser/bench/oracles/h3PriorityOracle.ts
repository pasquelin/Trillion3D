/**
 * Oracle du point H3-2 : `createTexturePriority` de `webgpuTexturePriority.ts` tel qu'il était avant
 * le lot, recopié ligne à ligne. Le banc et le test d'équivalence le lisent tous les deux.
 */
import type { TextureJob } from '../../webgpuAtlasJobs.ts';
import type { MaterialLayerIndex } from '../../webgpuTexturePriority.ts';

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
