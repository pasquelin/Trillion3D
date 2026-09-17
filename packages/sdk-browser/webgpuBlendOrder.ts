import { frustumExcludesBox } from '../sdk-core/index.ts';
import { planItem } from './webgpuBlendPlan.ts';
import { buildBlendRuns, RUN_SHARED, RUN_WORDS } from './webgpuBlendRuns.ts';
import { itemKept } from './webgpuBlendExpandCpu.ts';
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

/**
 * Pose la clé, le rang source et LE VERDICT DU TRONC de chaque item, et rend les rejets.
 *
 * C'est l'unique parcours d'items que l'image paie, et il fallait déjà le faire pour classer : le
 * tronc y coûte une boîte contre six plans, en double précision et par la référence elle-même. Le
 * verdict part sur la carte en un bit par item, et l'étalement du plan met à zéro les instances de
 * ce qu'il rejette (`webgpuBlendExpandWgsl.ts`) — un item hors champ ne coûte plus un appel, il ne
 * coûte plus une instance. Sans boîte exploitable, l'item n'est jamais rejeté.
 */
function refreshEyeKeys(blendState: BlendState, eye: ArrayLike<number>) {
  const items = blendState.blendGpu,
    keep = blendState.keepPacked,
    planes = blendState.blendPlanes,
    ex = eye[0],
    ey = eye[1],
    ez = eye[2];
  keep.fill(0);
  let rejected = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      box = item.bounds;
    item.orderRank = i;
    item.orderKey = eyeKey(item, ex, ey, ez);
    if (box && frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5])) {
      rejected++;
      continue;
    }
    keep[i >>> 5] |= 1 << (i & 31);
  }
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
    // Une seule question par entrée, et non une écriture par décalage : un saut de caméra décale
    // des millions de fois, et le tri ne doit rien payer de plus qu'avant pour le dire.
    if (j + 1 !== i) shifted = true;
  }
  return shifted;
}

/**
 * Les tranches que l'image encode : UN test par tranche, jamais un par entrée.
 *
 * Une tranche d'un seul item — une primitive non paginée, une surface transmissive — se décide sur
 * le bit du tronc, et l'appel d'un item entièrement hors champ n'est pas encodé, comme avant. Une
 * tranche partagée, elle, porte des milliers d'entrées : les interroger une à une rendrait à
 * l'image le parcours que ce lot lui retire. C'est la carte qui met ses instances à zéro, et un
 * appel sans instance ne pose aucun pixel — au pire une poignée d'appels vides quand plus rien de
 * la scène n'est dans le champ.
 */
function keptRuns(blendState: BlendState, slice: number) {
  const runs = slice ? blendState.runsTransmission : blendState.runsBlend,
    kept = blendState.runKept[slice],
    keep = blendState.keepPacked;
  for (let run = 0; run < blendState.runCount[slice]; run++) {
    const owner = runs[run * RUN_WORDS + 3];
    kept[run] = owner === RUN_SHARED || itemKept(keep, owner) ? 1 : 0;
  }
}

/**
 * Le classement du chemin de production, et le découpage en tranches qu'il commande.
 *
 * Les tranches ne dépendent que de l'ordre : un classement qui n'a rien bougé les laisse telles
 * quelles, et la carte n'a alors rien à relire. Rend le nombre d'items que le tronc a rejetés.
 */
export function orderBlendPasses(blendState: BlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) return 0;
  const rejected = refreshEyeKeys(blendState, eye);
  const items = blendState.blendGpu;
  const orders = [blendState.orderBlend, blendState.orderTransmission];
  const runs = [blendState.runsBlend, blendState.runsTransmission];
  for (let pass = 0; pass < orders.length; pass++) {
    if (!sortPlanFarToNear(orders[pass], items) && !blendState.orderMoved[pass]) continue;
    blendState.orderMoved[pass] = true;
    // La passe de transmission garde une tranche par entrée : chacune décale encore son volume.
    blendState.runCount[pass] = buildBlendRuns(orders[pass], pass === 0, runs[pass]);
  }
  for (let pass = 0; pass < orders.length; pass++) keptRuns(blendState, pass);
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
    const moved = visible[i];
    let j = i - 1;
    for (; j >= 0; j--) {
      const held = visible[j];
      if (
        !precedes(
          held.orderKey ?? 0,
          held.orderRank ?? 0,
          moved.orderKey ?? 0,
          moved.orderRank ?? 0,
        )
      )
        break;
      visible[j + 1] = held;
    }
    visible[j + 1] = moved;
  }
}
