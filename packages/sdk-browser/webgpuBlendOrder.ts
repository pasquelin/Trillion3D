import { frustumExcludesBox } from '../sdk-core/index.ts';
import { planItem } from './webgpuBlendPlan.ts';
import { buildBlendRuns } from './webgpuBlendRuns.ts';
import type { BlendGpuItem, createWebgpuBlendState } from './webgpuBlendState.ts';
type BlendState = ReturnType<typeof createWebgpuBlendState>;

/**
 * L'ORDRE DE PEINTURE DES SURFACES TRANSPARENTES, REPRIS À CHAQUE IMAGE.
 *
 * Un pipeline de mélange n'écrit pas la profondeur (`webgpuBlendPipelines.ts`) : deux surfaces
 * transparentes ne sont donc départagées par rien d'autre que l'ordre où elles sont encodées. Le
 * plan d'encodage, lui, est un objet de SCÈNE — l'ordre source, refait seulement quand les matrices
 * bougent — et ne peut pas porter cette décision, qui dépend de l'œil. C'est ce fichier qui la
 * porte : il ne touche pas au plan, il ordonne la liste d'entrées que la passe parcourt.
 *
 * CE SUR QUOI ON CLASSE : le carré de la distance de l'œil au centre de la boîte MONDE de l'item,
 * décroissant — le plus lointain d'abord, le plus proche en dernier. Une distance franche, jamais
 * une profondeur normalisée : la convention du moteur est inversée (`depthConvention.ts`) et le sens
 * d'un classement sur elle se lit à l'envers. Le carré suffit, il est monotone en la distance.
 *
 * L'ÉCART EST PRIS RELATIVEMENT À L'ŒIL, borne par borne, avant d'être moyenné : c'est l'espace du
 * reste du chemin, et un centre monde absolu perdrait ses bits utiles loin de l'origine.
 */

/** La clé d'un item : sans boîte exploitable, l'origine monde de son maillage en tient lieu. */
function eyeKey(item: BlendGpuItem, ex: number, ey: number, ez: number) {
  const box = item.bounds,
    m = item.matrix.elements;
  const x = box ? (box[0] - ex + (box[3] - ex)) / 2 : m[12] - ex,
    y = box ? (box[1] - ey + (box[4] - ey)) / 2 : m[13] - ey,
    z = box ? (box[2] - ez + (box[5] - ez)) / 2 : m[14] - ez;
  return x * x + y * y + z * z;
}

/** Pose la clé et le rang source de chaque item. Rien n'est alloué : deux champs réécrits. */
function refreshEyeKeys(blendState: BlendState, eye: ArrayLike<number>) {
  const items = blendState.blendGpu,
    ex = eye[0],
    ey = eye[1],
    ez = eye[2];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.orderRank = i;
    item.orderKey = eyeKey(item, ex, ey, ez);
  }
}

/**
 * LE VERDICT DU TRONC DE L'IMAGE : une boîte contre six plans, en double précision et par la
 * référence elle-même. Il part sur la carte en un bit par item, et l'étalement du plan met à zéro
 * les instances de ce qu'il rejette (`webgpuBlendExpandWgsl.ts`) — un item hors champ ne coûte plus
 * un appel, il ne coûte plus une instance. Sans boîte exploitable, l'item n'est jamais rejeté.
 *
 * Un SECOND parcours des mêmes items, et non une ligne de plus dans celui des clés : le travail est
 * le même, mais la boucle fusionnée ralentissait le tri qui la suit de quatre à neuf pour cent au
 * saut de caméra, mesuré par `transparents-ordres.bench.mjs` et reproduit sur cinq exécutions. Le
 * mécanisme n'est pas prouvé ; le remède, lui, est mesuré.
 */
function rejectByFrustum(blendState: BlendState) {
  const items = blendState.blendGpu,
    keep = blendState.keepPacked,
    planes = blendState.blendPlanes;
  let rejected = 0,
    bouge = false,
    mot = 0;
  // Le masque se compose mot par mot, et un mot n'est écrit que s'il a changé : une pose immobile
  // n'en change aucun, et c'est ce qui dispense l'image de le repousser sur la carte.
  const pose = (rang: number) => {
    if (keep[rang] !== mot >>> 0) {
      keep[rang] = mot;
      bouge = true;
    }
    mot = 0;
  };
  for (let i = 0; i < items.length; i++) {
    const box = items[i].bounds;
    if (box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5]))
      rejected++;
    else mot |= 1 << (i & 31);
    if ((i & 31) === 31) pose(i >>> 5);
  }
  if (items.length & 31) pose(items.length >>> 5);
  blendState.keepMoved = bouge;
  return rejected;
}

/**
 * L'ordre total que les DEUX chemins produisent : clé décroissante, puis rang source croissant.
 *
 * Le rang départage les clés égales, si bien que le résultat ne dépend ni de l'image précédente, ni
 * de l'ordre d'arrivée, ni de la machine — deux items superposés ne peuvent pas permuter d'une image
 * à l'autre, donc l'image ne scintille pas. `true` dit que l'entrée déjà placée doit reculer.
 */
const precedes = (keyA: number, rankA: number, keyB: number, rankB: number) =>
  keyA < keyB || (keyA === keyB && rankA > rankB);

/**
 * Le tri par insertion du plan, sur le tampon que l'image précédente a laissé.
 *
 * Une caméra qui bouge peu laisse la liste presque triée : l'insertion la reprend en un parcours et
 * quelques décalages, là où un tri complet la refait entièrement. Le tampon est celui de la scène,
 * réécrit sur place, et les deux entrées d'un item double face portent le même rang — elles ne se
 * dépassent donc jamais, et le dos reste devant la face.
 */
function sortPlanFarToNear(order: Uint32Array, items: readonly BlendGpuItem[]) {
  let shifted = false;
  for (let i = 1; i < order.length; i++) {
    const entry = order[i],
      moved = items[planItem(entry)],
      movedKey = moved.orderKey,
      movedRank = moved.orderRank;
    let j = i - 1;
    while (j >= 0) {
      const held = items[planItem(order[j])];
      if (!precedes(held.orderKey, held.orderRank, movedKey, movedRank)) break;
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = entry;
    // Une seule question par entrée, et non une écriture par décalage : un saut de caméra décale
    // des millions de fois, et le tri ne doit rien payer de plus qu'avant pour le dire.
    if (j + 1 !== i) shifted = true;
  }
  return shifted;
}

/**
 * Le classement du chemin de production, et le découpage en tranches qu'il commande.
 *
 * Les tranches ne dépendent que de l'ordre : un classement qui n'a rien bougé les laisse telles
 * quelles, et la carte n'a alors rien à relire. Rend le nombre d'items que le tronc a rejetés.
 *
 * SANS ŒIL, RIEN N'EST PEINT, et les tranches sont explicitement vidées. Cette fonction ne tient
 * plus seulement l'ordre : elle tient le verdict du tronc et le découpage, et des tranches laissées
 * là décriraient un ordre que l'image n'a pas classé — pire, un plan re-semé d'une autre longueur
 * depuis les indexerait hors de lui. Une image sans caméra n'a pas d'ordre de peinture ; elle ne
 * peint donc pas.
 */
export function orderBlendPasses(blendState: BlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) {
    blendState.runCount[0] = 0;
    blendState.runCount[1] = 0;
    return 0;
  }
  refreshEyeKeys(blendState, eye);
  const rejected = rejectByFrustum(blendState);
  const items = blendState.blendGpu,
    orders = blendState.orders;
  for (let pass = 0; pass < orders.length; pass++) {
    if (!sortPlanFarToNear(orders[pass], items) && !blendState.orderMoved[pass]) continue;
    blendState.orderMoved[pass] = true;
    // La passe de transmission garde une tranche par entrée : chacune décale encore son volume.
    blendState.runCount[pass] = buildBlendRuns(orders[pass], pass === 0, blendState.runs[pass]);
  }
  return rejected;
}

/**
 * Le même classement pour le chemin de repli, dont la liste de dessin est faite d'items et non
 * d'entrées de plan. La comparaison est celle d'au-dessus : les deux chemins peignent dans le même
 * ordre, et une machine sans tampon de visibilité ne voit pas une autre image.
 */
export function orderVisibleBlend(blendState: BlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) return;
  refreshEyeKeys(blendState, eye);
  const visible = blendState.visibleBlend;
  for (let i = 1; i < visible.length; i++) {
    const moved = visible[i],
      movedKey = moved.orderKey,
      movedRank = moved.orderRank;
    let j = i - 1;
    for (; j >= 0; j--) {
      const held = visible[j];
      if (!precedes(held.orderKey, held.orderRank, movedKey, movedRank)) break;
      visible[j + 1] = held;
    }
    visible[j + 1] = moved;
  }
}
