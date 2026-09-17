import type * as THREE from 'three';
import { maxStretch } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import { pixelScaleOf, worldBoxScreenRadius } from './streamingPriority.ts';
import { openUvSpanBudget, uvSpanOf } from './textureUvSpan.ts';
import { createFrameViews } from './textureFrameViews.ts';
import type { createTextureDemand } from './textureDemand.ts';
import {
  createTexturePriorityRows,
  ROW_NO_KEY,
  ROW_NO_LAYERS,
  type MaterialAtlasLayers,
  type MaterialLayerIndex,
} from './texturePriorityRows.ts';

/** La caméra que l'ordre lit : sa vue, sa projection et son plan proche, rien d'autre. */
export type PriorityCamera = {
  view: Float64Array;
  projection: Float64Array;
  near: number;
};

/** Ce que l'image en cours donne à l'ordre. */
export type PriorityInputs = {
  index: MaterialLayerIndex | undefined;
  /** La coupe que l'image demande au cache : les deux chemins de coupe la réécrivent à chaque image. */
  requested: readonly PageRec[];
  blend: readonly BlendGpuItem[];
  cam: PriorityCamera | undefined;
  viewport: readonly number[] | undefined;
  /** Largeur en texels de chaque couche, couleur et données, posée une fois à la préparation. */
  colorTexels: Float64Array | undefined;
  dataTexels: Float64Array | undefined;
  /** Grappes distinctes du catalogue de l'hôte : la taille des lignes tenues d'une image à l'autre. */
  keyCount: number;
};

type Demand = ReturnType<typeof createTextureDemand>;

/** La vue tant qu'aucune pose n'a été rencontrée : jamais lue, la première page en pose une. */
const EMPTY_VIEW: Float64Array<ArrayBufferLike> = new Float64Array(16);

/**
 * La mesure d'une image : l'empreinte écran de chaque couche d'atlas, puis le niveau voulu.
 *
 * Tout ce qui ne dépend pas de la caméra sort de la boucle (`texturePriorityRows.ts`) ; ne reste par
 * page que la projection de la sphère et le dépôt sur les couches de son matériau. Une page sans clé
 * de grappe — un montage sans catalogue — repasse par le chemin d'avant, page par page : les deux
 * donnent le même nombre, et c'est le banc `pompe-textures` qui le tient.
 */
export function createTextureMeasure(color: Demand, data: Demand) {
  const rows = createTexturePriorityRows();
  const frames = createFrameViews();
  const pixelScale: [number, number] = [1, 1];

  /** Dépose l'empreinte d'une surface sur les couches que son matériau lit. */
  const deposit = (layers: MaterialAtlasLayers | undefined, pixels: number, uvSpan: number) => {
    if (!layers || !(pixels > 0)) return;
    const areaPixels = pixels * pixels;
    color.add(layers.color, pixels, areaPixels, uvSpan);
    data.add(layers.data, pixels, areaPixels, uvSpan);
  };

  /** Mesure l'image ; rend faux tant qu'aucune caméra exploitable ne l'a dictée. */
  return (inputs: PriorityInputs) => {
    const { index, requested, blend, cam, viewport, colorTexels, dataTexels, keyCount } = inputs;
    color.reset();
    data.reset();
    frames.reset();
    openUvSpanBudget();
    const camStretch = cam ? maxStretch(cam.view as unknown as readonly number[]) : 0;
    let measured = false;
    if (index && cam && camStretch > 0 && rows.open(index, keyCount)) {
      measured = true;
      pixelScaleOf(cam.projection, viewport, pixelScale);
      const focal = Math.max(pixelScale[0], pixelScale[1]),
        near = cam.near || 1e-3;
      const { sphere, uvSpan, material, colorAt, colorCount, dataAt, dataCount, layers } =
        rows.views;
      // La coupe est groupée par primitive — le catalogue l'est, et la sélection en garde l'ordre —,
      // si bien qu'une page a presque toujours la pose de la précédente. La retenir vaut, par page,
      // un hachage et deux appels de moins ; la comparaison qui la garde ne coûte rien quand elle
      // échoue. Mesuré à un tiers de la boucle (banc `pompe-textures`).
      let held: THREE.Matrix4 | undefined,
        view = EMPTY_VIEW,
        stretch = 0;
      for (let i = 0; i < requested.length; i++) {
        const page = requested[i];
        if (page.matrix !== held) {
          const at = frames.of(page.matrix, cam.view);
          held = page.matrix;
          view = frames.view(at);
          stretch = frames.stretch(at);
        }
        // `ROW_NO_KEY` comme `ROW_NO_LAYERS` : la page ne dépose rien. La première n'arrive pas en
        // production — le catalogue pose une clé sur toute page (`webgpuPageTracking.ts`) et la
        // résidence refuse celles qui n'en ont pas —, et une seconde formule d'empreinte écran
        // gardée pour elle dériverait de celle-ci sans que rien ne l'exécute.
        const row = rows.of(page);
        if (row === ROW_NO_KEY || row === ROW_NO_LAYERS) continue;
        const base = row * 4,
          x = sphere[base],
          y = sphere[base + 1],
          z = sphere[base + 2];
        const cx = view[0] * x + view[4] * y + view[8] * z + view[12],
          cy = view[1] * x + view[5] * y + view[9] * z + view[13],
          cz = view[2] * x + view[6] * y + view[10] * z + view[14];
        const distance = Math.hypot(cx, cy, cz);
        const pixels = 2 * ((sphere[base + 3] * stretch * focal) / Math.max(distance, near));
        if (!(pixels > 0)) continue;
        const areaPixels = pixels * pixels,
          span = uvSpan[row],
          mat = material[row];
        color.addRange(layers, colorAt[mat], colorCount[mat], pixels, areaPixels, span);
        data.addRange(layers, dataAt[mat], dataCount[mat], pixels, areaPixels, span);
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
    return measured;
  };
}
