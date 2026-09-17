import type { PackedDag } from './gpuDagTypes.ts';
import { REQUEST_PRIORITY_MAX, requestPage, requestPriority } from './gpuDagRequest.ts';
import {
  OUT_COUNT,
  OUT_DRAWN_TRIANGLES,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_LOD_LEVEL,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
  OUT_UNCOVERED_TRIANGLES,
  SELECTION_HEADER_WORDS,
  selectionListCap,
} from './gpuDagLayout.ts';
import type { SelectionResult, SelectionUniforms } from './gpuSelection.ts';

/**
 * Les tableaux d'une fente de relecture, réutilisés d'une lecture à l'autre : les rallouer à chaque
 * relecture jetait des dizaines de milliers d'éléments au ramasse-miettes, pour y réécrire
 * exactement les mêmes rangs.
 */
export type DagOutputScratch = {
  result: SelectionResult;
  drawable: number[];
  /** Les seaux du tri par comptage, un par pas de priorité. Taille fixe, alloués une fois : le
   *  classement ne rend jamais rien au ramasse-miettes, quelle que soit la taille du relevé. */
  seaux: Uint32Array;
};
export const createDagOutputScratch = (): DagOutputScratch => ({
  result: { pageIds: [], frustumRejected: 0, lodLevel: 0 },
  drawable: [],
  seaux: new Uint32Array(REQUEST_PRIORITY_MAX + 1),
});

export function writeDagUniforms(
  target: Float32Array,
  packed: PackedDag,
  uniforms: SelectionUniforms,
  residentCut: boolean,
) {
  target.fill(0);
  target.set(uniforms.planes, 0);
  target.set(uniforms.view, 24);
  target[40] = uniforms.pixelScale[0];
  target[41] = uniforms.pixelScale[1];
  target[42] = uniforms.pixelError;
  target[43] = uniforms.near;
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length);
  ints[44] = packed.pageCount;
  ints[45] = packed.nodeCount;
  ints[46] = packed.worldCount;
  ints[47] = residentCut ? 1 : 0;
  const cw = uniforms.cameraWorld;
  if (cw) {
    target[48] = cw[0];
    target[49] = cw[1];
    target[50] = cw[2];
  }
  target[51] = uniforms.cameraStretch ?? 1;
  // Le plafond du relevé, que le noyau lit pour borner ses deux moitiés et pour dire, le cas
  // échéant, qu'il a tronqué (`gpuDagLayout.ts`).
  ints[52] = selectionListCap(packed.pageCount);
}

/** `drawnWordOffset` : rang du compte de la liste compactée dans le relevé, 0 quand il n'y en a pas. */
export function parseDagOutput(
  bytes: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
  drawnWordOffset: number,
  scratch: DagOutputScratch = createDagOutputScratch(),
): SelectionResult | null {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4));
  const head = SELECTION_HEADER_WORDS;
  const count = Math.min(
    ints[OUT_COUNT] ?? 0,
    Math.max(0, (drawnWordOffset || ints.length) - head),
  );
  // Tableaux dimensionnés d'avance : la lecture d'une image ne fait pas croître un tableau vide
  // élément par élément, et l'itérateur d'un tableau typé n'est jamais déroulé.
  const { result, drawable, seaux } = scratch,
    pageIds = result.pageIds;
  // Chaque rang est une DEMANDE : la page et sa priorité dans un mot (`gpuDagRequest.ts`). La liste
  // est rendue CLASSÉE, priorité décroissante — c'est dans cet ordre que l'hôte téléverse, et c'est
  // ce que le chemin WebGL2 fait depuis toujours (`orderPendingUrls`).
  //
  // TRI PAR COMPTAGE, et non par comparaison. La priorité est déjà quantifiée sur dix bits : mille
  // vingt-quatre seaux la couvrent en entier, et deux parcours suffisent — un pour compter, un pour
  // poser. Aucune comparaison, aucun rappel, aucun tampon intermédiaire : la liste se lit dans le
  // relevé et s'écrit directement dans `pageIds`, là où un tri par rangs demandait trois tableaux
  // ordinaires agrandis par `.length =` et n·log n appels de fermeture sur 262 144 rangs au plafond.
  //
  // Il est STABLE, et c'est ce qui le rend substituable : à priorité égale l'ordre reste celui du
  // relevé, exactement ce que rendait le tri par comparaison qu'il remplace.
  pageIds.length = count;
  seaux.fill(0);
  for (let i = 0; i < count; i++) seaux[requestPriority(ints[head + i])]++;
  // Somme préfixe menée de la priorité la plus HAUTE vers la plus basse : la liste sort décroissante
  // sans qu'on ait à la retourner.
  let place = 0;
  for (let p = REQUEST_PRIORITY_MAX; p >= 0; p--) {
    const tenus = seaux[p];
    seaux[p] = place;
    place += tenus;
  }
  for (let i = 0; i < count; i++) {
    const word = ints[head + i];
    pageIds[seaux[requestPriority(word)]++] = requestPage(word);
  }
  result.frustumRejected = ints[OUT_FRUSTUM_REJECTED] ?? 0;
  result.lodLevel = ints[OUT_LOD_LEVEL] ?? 0;
  result.complete = ((ints[OUT_FLAGS] ?? 0) & 2) === 0;
  // Les totaux que la carte tient : ils décrivent la coupe, pas la liste qui la rapporte, donc un
  // relevé tronqué les rend quand même justes (`gpuDagTotalsWgsl.ts`).
  result.selectedTriangles = ints[OUT_SELECTED_TRIANGLES] ?? 0;
  result.transparentTriangles = ints[OUT_TRANSPARENT_TRIANGLES] ?? 0;
  result.drawnTriangles = ints[OUT_DRAWN_TRIANGLES] ?? 0;
  result.uncoveredTriangles = ints[OUT_UNCOVERED_TRIANGLES] ?? 0;
  // Bit 1 : la coupe ne tenait pas sous le plafond du relevé. Ce n'est pas une panne de la carte —
  // les noyaux ont tourné, le masque de l'image est juste — mais la LISTE rapportée est amputée, et
  // rien de ce qui en vit ne doit la prendre pour la coupe entière.
  result.truncated = ((ints[OUT_FLAGS] ?? 0) & 1) !== 0;
  result.drawablePageIds = undefined;
  // La liste dessinable arrive déjà compactée, dans l'ordre croissant : le processeur ne parcourt
  // plus un drapeau par page du DAG, seulement les rangs que la carte graphique a retenus.
  if (drawnWordOffset) {
    const drawnCount = Math.min(
      ints[drawnWordOffset] ?? 0,
      Math.max(0, ints.length - drawnWordOffset - head),
    );
    drawable.length = drawnCount;
    for (let i = 0; i < drawnCount; i++) drawable[i] = ints[drawnWordOffset + head + i];
    result.drawablePageIds = drawable;
  }
  return result;
}
