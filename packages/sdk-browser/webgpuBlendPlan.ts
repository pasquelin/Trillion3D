import * as THREE from 'three';
import { matrixWindingCw } from '../sdk-core/index.ts';
import { blendChunkWords, blendVertexShift, planRegions, RUN_WORDS } from './webgpuBlendRuns.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** Les trois pipelines de la passe, nommes par un rang : une entree de plan les choisit sans test. */
const PIPELINE_NONE = 0;
export const PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2;
/** Une entree de plan : le rang de l'item dans les bits hauts, le pipeline dans les deux bas. */
const PLAN_SHIFT = 2;
const planEntry = (item: number, pipeline: number) => (item << PLAN_SHIFT) | pipeline;
export const planItem = (entry: number) => entry >>> PLAN_SHIFT;
export const planPipeline = (entry: number) => entry & 3;
/** Aucune primitive paginee derriere cet item : il dessine ses propres indices, par morceaux. */
export const DRAW_UNPAGED = 0xffffffff;
/** Les entrees de plan qu'un item peut poser au plus : le dos et la face d'un materiau double. */
const MAX_SIDES = 2;

/**
 * Le pas d'adressage de la scene : assez grand pour la plus longue instance, assez petit pour que
 * le rang de la premiere instance d'une tranche tienne dans les bits hauts d'un indice de sommet.
 * Une grappe paginee impose le plancher ; une primitive non paginee, decoupee en morceaux, peut
 * ceder si la liste etendue devient trop longue.
 */
function sceneVertexShift(items: readonly BlendGpuItem[], paged: number, capacity: number) {
  let longest = paged;
  for (const item of items) if (!item.paged) longest = Math.max(longest, item.count);
  const floor = blendVertexShift(paged);
  let shift = blendVertexShift(longest);
  while (shift > floor && instanceCapacity(items, shift, capacity) * 2 ** shift > 0xffffffff)
    shift--;
  return shift;
}

/** Les instances que la scene peut etaler au plus : la table paginee, plus les morceaux des autres,
 *  et le tout deux fois — un materiau double face porte deux entrees de plan. */
function instanceCapacity(items: readonly BlendGpuItem[], shift: number, capacity: number) {
  let total = capacity;
  for (const item of items)
    if (!item.paged) total += Math.ceil(item.count / blendChunkWords(shift, item.count));
  return total * MAX_SIDES;
}

/**
 * Les tables statiques de la passe transparente : ce qu'une instance dessine, et ou son item se
 * nomme.
 *
 * Une instance paginee dessine une grappe, une instance non paginee un morceau d'au plus un pas
 * d'indices. L'indice de sommet, lui, ne porte plus le rang de l'item mais le rang de la premiere
 * instance de sa tranche (`webgpuBlendRuns.ts`) : c'est ce qui permet a une tranche entiere de
 * tenir dans UN appel, et a tous les items pagines de partager UN groupe de liaison.
 */
export function buildBlendStatics(blendState: BlendState) {
  const items = blendState.blendGpu,
    table = blendState.table;
  const paged = table?.maxVertexWords ?? 0;
  const shift = sceneVertexShift(items, paged, table?.length ?? 0);
  blendState.vertexShift = shift;
  blendState.maxVertexWords = Math.max(3, paged);
  const draws = new Uint32Array(Math.max(1, items.length) * 4);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.tableBase =
      item.paged && table && item.pagedIndex !== undefined
        ? table.itemRanges[item.pagedIndex * 2]
        : 0;
    const known = item.paged && table && item.pagedIndex !== undefined;
    draws[i * 4] = known ? item.pagedIndex! : DRAW_UNPAGED;
    draws[i * 4 + 2] = item.tableBase;
    if (known) {
      // Les instances qu'une entrée de plan peut au plus étaler : ce que la table tient pour cet
      // item. Le noyau, lui, ne lit ce mot que pour une primitive non paginée.
      draws[i * 4 + 1] = table!.itemRanges[item.pagedIndex! * 2 + 1];
      continue;
    }
    const words = blendChunkWords(shift, item.count);
    draws[i * 4 + 1] = Math.ceil(item.count / words);
    draws[i * 4 + 3] = words;
  }
  blendState.drawsPacked = draws;
  blendState.keepPacked = new Uint32Array(Math.max(1, (items.length + 31) >> 5));
  // Un item pose au plus deux entrées de plan — le dos et la face —, et au plus une tranche par
  // entrée : les tables des deux passes sont donc taillées une fois, sur ce pire cas, et un
  // changement de matériau ou de miroir ne peut plus les faire déborder.
  const entries = Math.max(1, items.length) * MAX_SIDES;
  blendState.maxPlanEntries = entries;
  blendState.planRegions = planRegions(entries);
  blendState.runsBlend = new Uint32Array(entries * RUN_WORDS);
  blendState.runsTransmission = new Uint32Array(entries * RUN_WORDS);
  blendState.runKept = [new Uint32Array(entries), new Uint32Array(entries)];
  blendState.argsPacked = new Uint32Array(entries * 4 * 2);
}

/** Les deux entrees de plan d'un item double face, dans l'ordre que la passe encodait : dos, face. */
function sidesOf(item: BlendGpuItem) {
  const material = Array.isArray(item.material) ? item.material[0] : item.material;
  // Un seul determinant : l'appel rendait deux fois la meme valeur pour choisir les deux faces.
  const renverse = matrixWindingCw(item.matrix.elements);
  const front = renverse ? PIPELINE_FRONT : PIPELINE_BACK,
    back = renverse ? PIPELINE_BACK : PIPELINE_FRONT;
  if (material.side === THREE.DoubleSide && !material.forceSinglePass) return [back, front];
  if (material.side === THREE.FrontSide) return [front];
  if (material.side === THREE.BackSide) return [back];
  return [PIPELINE_NONE];
}

/**
 * Le plan d'encodage, refait quand la scene a change de matrices — et jamais par image. Une entree
 * porte le rang de l'item et le pipeline a poser, si bien que ni le classement ni le decoupage en
 * tranches ne lit un materiau.
 */
export function refreshBlendPlan(blendState: BlendState) {
  const items = blendState.blendGpu,
    draws = blendState.drawsPacked;
  const blend: number[] = [],
    transmission: number[] = [];
  // Les deux passes étalent leurs instances dans DEUX régions disjointes de la même liste : une
  // entrée de plan y met au plus ce que son item tient, et un item double face porte deux entrées.
  const room = [0, 0];
  // Les triangles que chaque passe SOUMET : un item double face en soumet deux fois les siens,
  // puisqu'il porte deux entrées de plan. Compté ici, avec le plan, et jamais par image.
  let blendTriangles = 0,
    transmissionTriangles = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      into = item.transmissive ? transmission : blend;
    const sides = sidesOf(item);
    room[item.transmissive ? 1 : 0] += sides.length * draws[i * 4 + 1];
    for (const side of sides) {
      into.push(planEntry(i, side));
      if (item.paged) continue;
      if (item.transmissive) transmissionTriangles += item.count / 3;
      else blendTriangles += item.count / 3;
    }
  }
  blendState.transmissionBase = room[0];
  blendState.instanceCapacity = Math.max(1, room[0] + room[1]);
  if (blendState.expandedPacked.length < blendState.instanceCapacity * 2)
    blendState.expandedPacked = new Uint32Array(blendState.instanceCapacity * 2);
  blendState.planBlend = Uint32Array.from(blend);
  blendState.planTransmission = Uint32Array.from(transmission);
  // L'ordre de peinture repart de l'ordre source : c'est la seule fois qu'il est semé, et le
  // classement par image le reprend ensuite sur place, sans jamais rallouer.
  blendState.orderBlend = blendState.planBlend.slice();
  blendState.orderTransmission = blendState.planTransmission.slice();
  blendState.orderMoved[0] = true;
  blendState.orderMoved[1] = true;
  blendState.blendTriangles = blendTriangles;
  blendState.transmissionTriangles = transmissionTriangles;
}
