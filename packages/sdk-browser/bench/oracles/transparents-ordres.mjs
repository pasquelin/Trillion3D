// Le chemin d'AVANT le lot « transparents en quelques ordres », recopié tel quel : le classement
// qui ne posait que des clés, les arguments indirects réécrits par item et par image, et la boucle
// d'encodage qui posait un `drawIndirect` par entrée de plan en retestant le tronc entrée par
// entrée. Les deux fichiers qui les portaient — `webgpuBlendArgs.ts` et `webgpuBlendSelect.ts` —
// n'existent plus : ces copies sont tout ce qui reste d'eux, et c'est leur raison d'être.
//
// C'est l'oracle : ces copies sont des doublons voulus, et le banc compare leur sortie à celle du
// chemin importé du paquet.
import * as THREE from 'three';
import { frustumExcludesBox, matrixWindingCw } from '../../../sdk-core/index.ts';

const UNPAGED = 0xffffffff;
/** Le plan d'avant : le rang de l'item, le pipeline dans les deux bits bas, et rien de plus. */
const planItem = (entry) => entry >>> 2;
const PIPELINE_NONE = 0,
  PIPELINE_FRONT = 1,
  PIPELINE_BACK = 2;

/** `webgpuBlendPlan.ts` d'avant : les deux entrées d'un item double face, dos puis face. */
function sidesOf(item) {
  const material = Array.isArray(item.material) ? item.material[0] : item.material;
  const renverse = matrixWindingCw(item.matrix.elements);
  const front = renverse ? PIPELINE_FRONT : PIPELINE_BACK,
    back = renverse ? PIPELINE_BACK : PIPELINE_FRONT;
  if (material.side === THREE.DoubleSide && !material.forceSinglePass) return [back, front];
  if (material.side === THREE.FrontSide) return [front];
  if (material.side === THREE.BackSide) return [back];
  return [PIPELINE_NONE];
}

/** Le plan de mélange d'avant, semé dans l'ordre source. */
export function planReference(items) {
  const blend = [];
  for (let i = 0; i < items.length; i++)
    for (const side of sidesOf(items[i])) blend.push((i << 2) | side);
  return Uint32Array.from(blend);
}

/** `webgpuBlendOrder.ts` d'avant : la clé d'un item, le carré de la distance de l'œil au centre. */
function eyeKey(item, ex, ey, ez) {
  const box = item.bounds,
    m = item.matrix.elements;
  const x = box ? (box[0] - ex + (box[3] - ex)) / 2 : m[12] - ex,
    y = box ? (box[1] - ey + (box[4] - ey)) / 2 : m[13] - ey,
    z = box ? (box[2] - ez + (box[5] - ez)) / 2 : m[14] - ez;
  return x * x + y * y + z * z;
}

const precedes = (keyA, rankA, keyB, rankB) => keyA < keyB || (keyA === keyB && rankA > rankB);

/** Le tri par insertion du plan, sur le tampon que l'image précédente a laissé. */
function sortPlanFarToNear(order, items) {
  for (let i = 1; i < order.length; i++) {
    const entry = order[i],
      moved = items[planItem(entry)];
    let j = i - 1;
    while (j >= 0) {
      const held = items[planItem(order[j])];
      if (
        !precedes(
          held.orderKey ?? 0,
          held.orderRank ?? 0,
          moved.orderKey ?? 0,
          moved.orderRank ?? 0,
        )
      )
        break;
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = entry;
  }
}

/** Le classement d'avant : des clés, un rang source, et rien d'autre. */
export function classementReference(scene, order, eye) {
  const items = scene.items;
  for (let i = 0; i < items.length; i++) {
    items[i].orderRank = i;
    items[i].orderKey = eyeKey(items[i], eye[0], eye[1], eye[2]);
  }
  sortPlanFarToNear(order, items);
}

/** Les arguments indirects d'avant : quatre mots par item, réécrits en entier à chaque image. */
export function argumentsReference(scene, args) {
  const { items, planes, draws, itemCounts } = scene;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      box = item.bounds;
    const out = !!box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5]);
    args[i * 4] = draws[i * 4 + 1];
    args[i * 4 + 1] = out ? 0 : item.paged ? (itemCounts[item.pagedIndex] ?? 0) : 1;
    args[i * 4 + 2] = draws[i * 4 + 2];
    args[i * 4 + 3] = 0;
  }
}

/**
 * La boucle d'encodage d'avant : un `drawIndirect` par entrée du plan, le tronc reteste en double
 * précision, et l'item entièrement hors champ n'est pas encodé. Rend les appels encodés, les items
 * rejetés, et la suite des plages d'indices que le rasteriseur aurait vues.
 */
export function encodeReference(scene, order, args, sortie) {
  const { items, planes, spans, instances } = scene;
  let encoded = 0,
    rejete = -1,
    rejected = 0,
    at = 0;
  for (let i = 0; i < order.length; i++) {
    const index = planItem(order[i]),
      item = items[index],
      box = item.bounds;
    if (box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])) {
      if (index !== rejete) rejected++;
      rejete = index;
      continue;
    }
    encoded++;
    const held = args[index * 4 + 1];
    for (let j = 0; j < held; j++) {
      const entry = item.paged ? instances[item.tableBase + j] : UNPAGED;
      sortie[at++] = index;
      sortie[at++] = item.paged ? spans[entry * 2] : 0;
      sortie[at++] = item.paged ? spans[entry * 2 + 1] : item.count;
    }
  }
  return { encoded, rejected, length: at };
}
