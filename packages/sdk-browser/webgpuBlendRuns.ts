import { planItem, planPipeline, planShared } from './webgpuBlendPlan.ts';

/**
 * LES TRANCHES DE LA PASSE TRANSPARENTE : ce qui remplace un appel par item.
 *
 * Le plan trié du plus lointain au plus proche (`webgpuBlendOrder.ts`) reste la contrainte de
 * correction : un mélange n'écrit pas la profondeur, et seul l'ordre où les primitives passent le
 * rasteriseur départage deux surfaces. Or cet ordre est GARANTI À L'INTÉRIEUR D'UN APPEL : les
 * primitives d'un appel sont rasterisées instance par instance, et dans chaque instance sommet par
 * sommet. Une suite d'entrées de plan qui pose le même pipeline et lit les mêmes tampons peut donc
 * tenir dans UN SEUL appel dont les instances sont, dans l'ordre, celles de chaque entrée.
 *
 * Une tranche s'arrête sur trois choses, et sur rien d'autre :
 * - le pipeline change (le dos et la face d'un item double face en posent deux) ;
 * - l'item n'est pas paginé : il porte ses propres tampons d'indices, de positions et d'UV, donc
 *   son propre groupe de liaison, et ne peut pas partager l'appel de ses voisins ;
 * - la passe de transmission demande une tranche par entrée, parce que chacune décale encore
 *   l'uniforme de volume de son matériau (`webgpuTransmission.ts`).
 *
 * Le pire cas rend donc exactement les appels d'avant ; le cas ordinaire — des primitives paginées
 * qui partagent un pipeline — les rend tous en un.
 */

/** Les deux passes : le mélange, puis la transmission sur le fond figé. */
export const EXPAND_PASSES = 2;
/** Les entrées de plan qu'un fil de comptage du noyau couvre. */
export const EXPAND_GROUP = 64;
/** Quatre mots par tranche : première entrée, nombre d'entrées, pipeline, item propriétaire. */
export const RUN_WORDS = 4;
/** Une tranche partagée n'appartient à aucun item : son groupe de liaison est celui des paginés. */
export const RUN_SHARED = 0xffffffff;
/** Le bit de partage d'une entrée de plan, juste au-dessus des deux bits de pipeline. */
const PLAN_SHARED_BIT = 4;

/**
 * Le pas d'adressage d'une instance : la puissance de deux qui sépare deux instances dans l'espace
 * des indices de sommet.
 *
 * L'appel indirect d'une tranche commence au sommet `base << shift`, où `base` est le rang de sa
 * première instance dans la liste étendue. Le nuanceur retrouve donc ce rang dans les bits hauts de
 * l'indice de sommet et son rang local dans les bas — le même tour que l'ancien plan jouait avec le
 * rang de l'item. `firstInstance` aurait dit la même chose, mais WebGPU ne l'autorise dans un appel
 * indirect que sous une extension ; `firstVertex`, lui, est toujours libre quand aucun tampon de
 * sommets n'est lié, et c'est le cas de cette passe.
 */
export function blendVertexShift(maxVertexWords: number) {
  let shift = 2;
  while (shift < 30 && 1 << shift < Math.max(4, maxVertexWords)) shift++;
  return shift;
}

/** Les sommets qu'une instance d'une primitive NON paginée dessine : le plus grand multiple de
 *  trois que le pas d'adressage laisse passer, et jamais plus que ce que la primitive porte. */
export function blendChunkWords(shift: number, indexCount: number) {
  return Math.max(3, Math.min(indexCount, 3 * Math.floor((1 << shift) / 3)));
}

/**
 * Écrit les tranches du plan trié et rend leur nombre.
 *
 * `merge` faux donne une tranche par entrée : c'est la passe de transmission, dont chaque item
 * garde son décalage dynamique. `out` appartient à la scène et fait `RUN_WORDS` mots par entrée du
 * plan — le pire cas —, si bien que rien n'est alloué par image.
 */
export function buildBlendRuns(order: Uint32Array, merge: boolean, out: Uint32Array) {
  let runs = 0,
    first = 0;
  while (first < order.length) {
    const pipeline = planPipeline(order[first]);
    const shared = merge && planShared(order[first]);
    // Une entrée prolonge la tranche quand elle porte le même pipeline ET le bit de partage : les
    // deux tiennent dans les trois bits bas, et le plan se parcourt sans jamais suivre un rang.
    const suite = PLAN_SHARED_BIT | pipeline;
    let end = first + 1;
    if (shared) while (end < order.length && (order[end] & 7) === suite) end++;
    const base = runs * RUN_WORDS;
    out[base] = first;
    out[base + 1] = end - first;
    out[base + 2] = pipeline;
    // Une tranche n'est SANS propriétaire que si elle en fusionne plusieurs : celle qui n'a gardé
    // qu'une entrée nomme son item, et l'image peut alors ne pas l'encoder du tout quand le tronc
    // le rejette — exactement ce que faisait un appel par item.
    out[base + 3] = shared && end - first > 1 ? RUN_SHARED : planItem(order[first]);
    runs++;
    first = end;
  }
  return runs;
}

/** Ce que chaque passe occupe : son ordre et ses tranches dans le plan, ses arguments indirects. */
export function planRegions(maxEntries: number) {
  const regions = [];
  for (let pass = 0; pass < EXPAND_PASSES; pass++)
    regions.push({
      order: pass * maxEntries * (1 + RUN_WORDS),
      runs: pass * maxEntries * (1 + RUN_WORDS) + maxEntries,
      args: pass * maxEntries * 4,
    });
  return regions;
}

/** Les mots que le plan et la mémoire de travail du noyau occupent pour toute la scène. */
export const planWords = (maxEntries: number) => maxEntries * (1 + RUN_WORDS) * EXPAND_PASSES;
export const scratchWords = (maxEntries: number) =>
  maxEntries + Math.ceil(maxEntries / EXPAND_GROUP);
