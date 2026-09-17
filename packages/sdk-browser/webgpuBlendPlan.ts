import * as THREE from 'three';
import { matrixWindingCw } from '../sdk-core/index.ts';
import { blendChunkWords, blendVertexShift, planRegions, RUN_WORDS } from './webgpuBlendRuns.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/** Les trois pipelines de la passe, nommes par un rang : une entree de plan les choisit sans test. */
const PIPELINE_NONE = 0;
export const PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2;
/**
 * Une entree de plan : le rang de l'item dans les bits hauts, puis le bit qui dit si l'item peut
 * PARTAGER l'appel de ses voisins, et le pipeline dans les deux bas.
 *
 * Le bit de partage est dans l'entree, et non lu sur l'item, parce que le decoupage en tranches
 * parcourt le plan TRIE : suivre un rang d'item vers son objet, c'est un acces memoire au hasard
 * par entree, quand la seule lecture du plan est un parcours sequentiel.
 */
/** Les trois bits bas d'une entrée : deux de pipeline, puis le bit de partage. Le rang de l'item
 *  occupe le reste. `webgpuBlendRuns.ts` et `webgpuBlendExpandWgsl.ts` lisent ces trois-là d'ici :
 *  décaler le rang sans les suivre laisserait les trois autres sites compiler et décoder faux. */
export const PLAN_SHIFT = 3;
export const PLAN_SHARED_BIT = 4;
/** Le masque des trois bits bas : deux entrées le partagent quand elles tiennent dans une tranche. */
export const PLAN_LOW_MASK = (1 << PLAN_SHIFT) - 1;
export const planEntry = (item: number, pipeline: number, shared: boolean) =>
  (item << PLAN_SHIFT) | (shared ? PLAN_SHARED_BIT : 0) | pipeline;
export const planItem = (entry: number) => entry >>> PLAN_SHIFT;
export const planPipeline = (entry: number) => entry & 3;
export const planShared = (entry: number) => (entry & PLAN_SHARED_BIT) !== 0;
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
  // Seules les primitives NON paginees dependent du pas : leurs longueurs sont ramassees une fois,
  // et la capacite se recalcule sur cette seule liste quand le pas cede.
  const libres: number[] = [];
  let longest = paged;
  for (const item of items)
    if (!item.paged) {
      libres.push(item.count);
      longest = Math.max(longest, item.count);
    }
  const floor = blendVertexShift(paged);
  let shift = blendVertexShift(longest);
  while (shift > floor && instanceCapacity(libres, shift, capacity) * 2 ** shift > 0xffffffff)
    shift--;
  return shift;
}

/** Les instances que la scene peut etaler au plus : la table paginee, plus les morceaux des autres,
 *  et le tout deux fois — un materiau double face porte deux entrees de plan. */
function instanceCapacity(libres: readonly number[], shift: number, capacity: number) {
  let total = capacity;
  for (const count of libres) total += Math.ceil(count / blendChunkWords(shift, count));
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
  // Les deux passes étalent leurs instances dans DEUX régions disjointes de la même liste. Leur
  // taille est celle du PIRE CAS — deux entrées de plan par item —, et non celle du plan courant :
  // `sidesOf` lit le matériau VIVANT, que l'hôte partage avec son maillage, et un matériau passé en
  // double face entre deux images ferait déborder la liste et pousserait la région de transmission
  // au-delà de sa fin. Les écritures hors bornes du noyau sont jetées en silence : la géométrie
  // transparente disparaîtrait sans une erreur.
  const room = [0, 0];
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
      room[item.transmissive ? 1 : 0] += MAX_SIDES * draws[i * 4 + 1];
      continue;
    }
    const words = blendChunkWords(shift, item.count);
    draws[i * 4 + 1] = Math.ceil(item.count / words);
    draws[i * 4 + 3] = words;
    room[item.transmissive ? 1 : 0] += MAX_SIDES * draws[i * 4 + 1];
  }
  blendState.instanceBase[1] = room[0];
  blendState.instanceCapacity = Math.max(1, room[0] + room[1]);
  blendState.drawsPacked = draws;
  blendState.keepPacked = new Uint32Array(Math.max(1, (items.length + 31) >> 5));
  // Même pire cas pour les tables du plan et de ses tranches, et pour la même raison.
  const entries = Math.max(1, items.length) * MAX_SIDES;
  blendState.maxPlanEntries = entries;
  blendState.planRegions = planRegions(entries);
  blendState.runs = [new Uint32Array(entries * RUN_WORDS), new Uint32Array(entries * RUN_WORDS)];
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
  const items = blendState.blendGpu;
  const blend: number[] = [],
    transmission: number[] = [];
  // Les triangles que chaque passe SOUMET : un item double face en soumet deux fois les siens,
  // puisqu'il porte deux entrées de plan. Compté ici, avec le plan, et jamais par image.
  let blendTriangles = 0,
    transmissionTriangles = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      into = item.transmissive ? transmission : blend;
    for (const side of sidesOf(item)) {
      into.push(planEntry(i, side, !!item.paged));
      if (item.paged) continue;
      if (item.transmissive) transmissionTriangles += item.count / 3;
      else blendTriangles += item.count / 3;
    }
  }
  // L'ordre de peinture repart de l'ordre source : c'est la seule fois qu'il est semé, et le
  // classement par image le reprend ensuite sur place, sans jamais rallouer. Il n'y a rien à
  // garder du plan non classé : personne ne le relit, et une seconde copie de la même liste
  // demanderait de la tenir d'accord avec celle qui est peinte.
  blendState.orders = [Uint32Array.from(blend), Uint32Array.from(transmission)];
  blendState.orderMoved[0] = true;
  blendState.orderMoved[1] = true;
  blendState.blendTriangles = blendTriangles;
  blendState.transmissionTriangles = transmissionTriangles;
}
