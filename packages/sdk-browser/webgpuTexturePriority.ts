import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';

/** Couches d'atlas qu'un matériau lit : ce qui relie une surface dessinée aux textures à transférer. */
type MaterialAtlasLayers = { color: readonly number[]; data: readonly number[] };
export type MaterialLayerIndex = Map<THREE.Material | THREE.Material[], MaterialAtlasLayers>;

/** Ce que la coupe de l'image précédente a déjà décidé, seule source de la priorité. */
type PriorityInputs = {
  index: MaterialLayerIndex | undefined;
  drawn: readonly PageRec[];
  blend: readonly BlendGpuItem[];
};

/**
 * L'ordre de transfert, recalculé à chaque image à partir d'un signal que le moteur produit déjà :
 * les pages opaques et transparentes que la coupe a retenues (`run.drawn`) et les maillages
 * transparents visibles (`blendState.visibleBlend`). Aucune passe GPU, aucune lecture bloquante —
 * ces deux listes sont réécrites par la coupe de chaque image et se lisent à coût nul.
 *
 * Le poids d'un slot est le nombre de triangles dessinés par les surfaces qui le lisent : une
 * texture que la caméra regarde de près pèse plus qu'une texture au loin. À poids égal, les niveaux
 * progressifs d'une texture passent avant sa pleine résolution — quelques kilooctets donnent une
 * image lisible que des mégaoctets mettraient des dizaines d'images à donner ; puis un niveau déjà
 * entamé passe devant un niveau intact, ce qui borne le nombre de transferts à moitié faits ; à
 * poids, étage et avancement égaux l'ordre d'origine est conservé. Un niveau entamé peut donc être
 * relégué entre deux tranches, jamais au milieu d'une tranche.
 */
export function createTexturePriority(inputs: () => PriorityInputs) {
  const colorWeights: number[] = [];
  const dataWeights: number[] = [];
  const addWeight = (layers: MaterialAtlasLayers | undefined, triangles: number) => {
    if (!layers) return;
    for (const layer of layers.color) {
      while (colorWeights.length <= layer) colorWeights.push(0);
      colorWeights[layer] += triangles;
    }
    for (const layer of layers.data) {
      while (dataWeights.length <= layer) dataWeights.push(0);
      dataWeights[layer] += triangles;
    }
  };
  const weightOf = (job: TextureJob) =>
    (job.kind === 'color' ? colorWeights : dataWeights)[job.slot] ?? 0;
  /** Réordonne la file en place ; sans signal exploitable, elle garde l'ordre où elle a été bâtie. */
  const order = (jobs: TextureJob[]) => {
    if (jobs.length < 2) return;
    const { index, drawn, blend } = inputs();
    colorWeights.fill(0);
    dataWeights.fill(0);
    if (index) {
      for (const page of drawn) addWeight(index.get(page.material), page.triangles);
      for (const item of blend) addWeight(index.get(item.material), item.count / 3);
    }
    jobs.sort(
      (a, b) =>
        weightOf(b) - weightOf(a) || a.stage - b.stage || (b.nextRow ? 1 : 0) - (a.nextRow ? 1 : 0),
    );
  };
  return { order };
}
