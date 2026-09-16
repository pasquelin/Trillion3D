import type * as THREE from 'three';
import { maxStretch } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import { boundsScreenRadius, pixelScaleOf, worldBoxScreenRadius } from './streamingPriority.ts';
import { openUvSpanBudget, uvSpanOf } from './textureUvSpan.ts';
import { createTextureDemand } from './textureDemand.ts';
import { createFrameViews } from './textureFrameViews.ts';

/** Couches d'atlas qu'un matériau lit : ce qui relie une surface dessinée aux textures à transférer. */
type MaterialAtlasLayers = { color: readonly number[]; data: readonly number[] };
export type MaterialLayerIndex = Map<THREE.Material | THREE.Material[], MaterialAtlasLayers>;

/** La caméra que l'ordre lit : sa vue, sa projection et son plan proche, rien d'autre. */
export type PriorityCamera = {
  view: Float64Array;
  projection: Float64Array;
  near: number;
};

/** Ce que l'image en cours donne à l'ordre. */
type PriorityInputs = {
  index: MaterialLayerIndex | undefined;
  /** La coupe que l'image demande au cache : les deux chemins de coupe la réécrivent à chaque image. */
  requested: readonly PageRec[];
  blend: readonly BlendGpuItem[];
  cam: PriorityCamera | undefined;
  viewport: readonly number[] | undefined;
  /** Largeur en texels de chaque couche, couleur et données, posée une fois à la préparation. */
  colorTexels: Float64Array | undefined;
  dataTexels: Float64Array | undefined;
};

/**
 * L'ordre de transfert des textures, dicté par l'écran.
 *
 * Ce qui décide n'est plus le nombre de triangles d'une surface mais sa place à l'écran : l'empreinte
 * projetée des clusters que la coupe demande, croisée avec l'étendue uv de leur géométrie, donne le
 * niveau de mip que chaque couche appelle vraiment (texel par pixel). Le poids d'un travail est
 * l'écart entre ce qui est résident et ce niveau, multiplié par l'aire écran de la couche : ce que
 * la caméra regarde devient net d'abord, le lointain et le hors champ attendent leur tour.
 *
 * Les niveaux progressifs passent toujours avant toute pleine résolution, et la couleur avant les
 * données : une queue de mips tient en quelques kilooctets et rend l'image lisible dès la première
 * image, tandis qu'une couche de données absente ne montre que les facteurs scalaires du matériau.
 * Un travail dont la couche est déjà au niveau voulu pèse zéro : il part en fin de file, sans jamais
 * être abandonné — la file finit par se vider et l'image finale est celle d'avant, au pixel près.
 *
 * Rien n'est alloué par image : les empreintes, les niveaux et les vues vivent dans des tampons
 * possédés, réécrits sur place, qui ne grandissent qu'à la découverte d'une scène.
 */
export function createTexturePriority(inputs: () => PriorityInputs) {
  const color = createTextureDemand(),
    data = createTextureDemand();
  const frames = createFrameViews();
  const pixelScale: [number, number] = [1, 1];
  let lastMs = 0;
  /** Vrai dès qu'une image a été mesurée avec une caméra exploitable. */
  let screenKnown = false;
  const demandOf = (kind: TextureJob['kind']) => (kind === 'color' ? color : data);

  /** Dépose l'empreinte d'une surface sur les couches que son matériau lit. */
  const deposit = (layers: MaterialAtlasLayers | undefined, pixels: number, uvSpan: number) => {
    if (!layers || !(pixels > 0)) return;
    const areaPixels = pixels * pixels;
    color.add(layers.color, pixels, areaPixels, uvSpan);
    data.add(layers.data, pixels, areaPixels, uvSpan);
  };

  /** Mesure l'image : empreinte écran de chaque couche, puis niveau voulu avec hystérésis. */
  const measure = () => {
    const { index, requested, blend, cam, viewport, colorTexels, dataTexels } = inputs();
    color.reset();
    data.reset();
    frames.reset();
    openUvSpanBudget();
    const camStretch = cam ? maxStretch(cam.view as unknown as readonly number[]) : 0;
    if (index && cam && camStretch > 0) {
      screenKnown = true;
      pixelScaleOf(cam.projection, viewport, pixelScale);
      const focal = Math.max(pixelScale[0], pixelScale[1]),
        near = cam.near || 1e-3;
      for (let i = 0; i < requested.length; i++) {
        const page = requested[i];
        const at = frames.of(page.matrix, cam.view);
        const radius = boundsScreenRadius(page, frames.view(at), frames.stretch(at), focal, near);
        deposit(index.get(page.material), 2 * radius, uvSpanOf(page.attributes));
      }
      for (let i = 0; i < blend.length; i++) {
        const item = blend[i];
        if (!item.bounds) continue;
        const radius = worldBoxScreenRadius(item.bounds, cam.view, camStretch, focal, near);
        deposit(index.get(item.material), 2 * radius, uvSpanOf(item.sourceGeometry?.attributes));
      }
    }
    color.settle(colorTexels);
    data.settle(dataTexels);
  };

  /**
   * L'utilité d'un travail : l'aire écran de sa couche par le nombre de niveaux qui lui manquent.
   *
   * Une couche déjà au niveau que l'écran demande pèse zéro et part en fin de file — le lointain et
   * le hors champ, dont la queue d'aperçus suffit, n'y prennent plus la place de ce que la caméra
   * regarde. Ils ne sont pas abandonnés pour autant : quand plus rien d'utile n'attend, la file se
   * vide et l'image finale reste celle d'avant, au pixel près.
   */
  const scoreOf = (job: TextureJob) => {
    const demand = demandOf(job.kind);
    const gap = demand.gapOf(job.slot);
    return gap > 0 ? demand.areaOf(job.slot) * gap : 0;
  };
  /** La couleur avant les données : seule la couleur manquante se voit. */
  const rank = (job: TextureJob) => (job.kind === 'color' ? 0 : 1);
  const order = (jobs: TextureJob[]) => {
    const started = performance.now();
    measure();
    if (jobs.length > 1)
      jobs.sort(
        (a, b) =>
          a.stage - b.stage ||
          rank(a) - rank(b) ||
          scoreOf(b) - scoreOf(a) ||
          (b.nextRow ? 1 : 0) - (a.nextRow ? 1 : 0),
      );
    lastMs = performance.now() - started;
  };
  return {
    order,
    scoreOf,
    /** Un niveau de plus est résident sur ce slot ; la pleine résolution vaut le niveau zéro. */
    markLevel(kind: TextureJob['kind'], slot: number, level: number) {
      demandOf(kind).markLevel(slot, level);
    },
    /** Vrai dès qu'une caméra exploitable a mesuré une image : avant, aucune pleine résolution ne
     *  part, seules les queues d'aperçus. Une préparation ne dépense pas le budget d'une image dans
     *  un ordre que l'écran n'a pas encore dicté. */
    get screenKnown() {
      return screenKnown;
    },
    /** Coût processeur de la dernière passe de priorité, déposé sur l'étape « textures ». */
    get lastMs() {
      return lastMs;
    },
    /** Ce que l'hôte affiche : couches au niveau voulu, couches visibles, niveaux manquants. */
    get counters() {
      return color.counters;
    },
    get layers() {
      return color.layers;
    },
  };
}
