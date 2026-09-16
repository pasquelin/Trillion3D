import { planItem } from './webgpuBlendPlan.ts';
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

/** Le classement du chemin de production : les deux plans, du plus lointain au plus proche. */
export function orderBlendPasses(blendState: BlendState, eye: ArrayLike<number> | undefined) {
  if (!eye || !blendState.blendGpu.length) return;
  refreshEyeKeys(blendState, eye);
  sortPlanFarToNear(blendState.orderBlend, blendState.blendGpu);
  sortPlanFarToNear(blendState.orderTransmission, blendState.blendGpu);
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
