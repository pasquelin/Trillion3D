import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';

/** Couches d'atlas qu'un matériau lit : ce qui relie une surface dessinée aux textures à transférer. */
type MaterialAtlasLayers = { color: readonly number[]; data: readonly number[] };
export type MaterialLayerIndex = Map<THREE.Material | THREE.Material[], MaterialAtlasLayers>;

/** Ce que l'image précédente a demandé au cache, seule source de la priorité. */
type PriorityInputs = {
  index: MaterialLayerIndex | undefined;
  /** La coupe que l'image demande au cache : les deux chemins de coupe la réécrivent à chaque
   *  image, y compris quand aucun relevé de sélection n'a encore été adopté. */
  requested: readonly PageRec[];
  blend: readonly BlendGpuItem[];
};

/**
 * L'ordre de transfert, recalculé à chaque image à partir d'un signal que le moteur produit déjà :
 * les pages que la coupe demande au cache (`run.desired`) et les maillages transparents visibles
 * (`blendState.visibleBlend`). Aucune passe GPU, aucune lecture bloquante — ces deux listes sont
 * réécrites par la coupe de chaque image et se lisent à coût nul.
 *
 * C'est bien la coupe demandée, et pas la coupe dessinée : `run.drawn` n'est refait que lorsqu'un
 * relevé de sélection est adopté, ce qui n'arrive en pratique qu'à `flush()`. En boucle d'images
 * libre il reste vide, puis figé sur un vieux relevé — le poids de chaque slot vaut alors zéro, la
 * file n'est plus réordonnée et les textures arrivent dans l'ordre de l'atlas, pas dans celui que la
 * caméra dicte.
 *
 * Les niveaux progressifs passent d'abord, tous, avant toute pleine résolution : la queue de mips
 * d'une texture tient en quelques kilooctets, celle de la scène entière dans une fraction du budget
 * d'une image, alors qu'une seule pleine résolution le remplit entièrement. Les faire attendre
 * derrière des mégaoctets laisserait des surfaces au remplissage blanc pendant des centaines
 * d'images ; les passer d'abord donne une image lisible dès la première.
 *
 * Vient ensuite la couleur avant les données. Une couche couleur qui manque se voit — la surface
 * reste au niveau grossier de sa pyramide — alors qu'une couche de données qui manque rend le
 * remplissage du matériau, normale plate ou blanc, c'est-à-dire ses facteurs scalaires. Les données
 * pèsent ici deux fois la couleur en octets : les servir d'abord retiendrait la couleur pendant des
 * centaines d'images pour un gain invisible.
 *
 * Vient enfin le poids : le nombre de triangles demandés par les surfaces qui lisent le slot. Une
 * texture que la caméra regarde de près pèse plus qu'une texture au loin, donc sa pleine résolution
 * arrive la première. À poids égal, un niveau déjà entamé passe devant un niveau intact, ce qui
 * borne le nombre de transferts à moitié faits ; à étage, nature, poids et avancement égaux l'ordre
 * d'origine est conservé. Un niveau entamé peut donc être relégué entre deux tranches, jamais au
 * milieu d'une tranche.
 */
/**
 * Les poids d'un étage, tenus dans un tableau de doubles au lieu d'un tableau JavaScript agrandi
 * d'une case par couche. Le nombre de couches n'est pas connu quand la file naît — l'index des
 * matériaux est refait à chaque scène chargée — donc la capacité double au lieu d'être fixée
 * d'avance. Les poids restent des doubles, `triangles` valant `count / 3` sur un transparent : une
 * addition IEEE 754 dans `Float64Array` est celle d'un `number`, à l'octet près. Les cases au-delà
 * de la dernière couche vue valent zéro des deux côtés, que la capacité les couvre ou non.
 */
type Weights = { values: Float64Array };

export function createTexturePriority(inputs: () => PriorityInputs) {
  const colorWeights: Weights = { values: new Float64Array(0) };
  const dataWeights: Weights = { values: new Float64Array(0) };
  const bump = (weights: Weights, layers: readonly number[], triangles: number) => {
    for (const layer of layers) {
      if (layer >= weights.values.length) {
        let taille = weights.values.length || 8;
        while (taille <= layer) taille *= 2;
        const grandi = new Float64Array(taille);
        grandi.set(weights.values);
        weights.values = grandi;
      }
      weights.values[layer] += triangles;
    }
  };
  const addWeight = (layers: MaterialAtlasLayers | undefined, triangles: number) => {
    if (!layers) return;
    bump(colorWeights, layers.color, triangles);
    bump(dataWeights, layers.data, triangles);
  };
  const weightOf = (job: TextureJob) =>
    (job.kind === 'color' ? colorWeights : dataWeights).values[job.slot] ?? 0;
  /** La couleur avant les données : seule la couleur manquante se voit. */
  const rank = (job: TextureJob) => (job.kind === 'color' ? 0 : 1);
  /** Réordonne la file en place ; sans signal exploitable, elle garde l'ordre où elle a été bâtie. */
  const order = (jobs: TextureJob[]) => {
    if (jobs.length < 2) return;
    const { index, requested, blend } = inputs();
    colorWeights.values.fill(0);
    dataWeights.values.fill(0);
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
