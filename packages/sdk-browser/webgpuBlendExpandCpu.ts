import { DRAW_UNPAGED, planItem } from './webgpuBlendPlan.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from './webgpuBlendRuns.ts';
import type { createWebgpuBlendState } from './webgpuBlendState.ts';

/**
 * Tout ce que l'étalement du plan lit et écrit, sans un seul objet graphique : c'est la SÉMANTIQUE
 * de référence du noyau de `webgpuBlendExpandWgsl.ts`, et c'est aussi le chemin qu'emprunte, tel
 * quel, un appareil sans étage de calcul.
 */
export type BlendExpansion = {
  /** Le plan trié du plus lointain au plus proche, et les tranches qui le découpent. */
  order: Uint32Array;
  runs: Uint32Array;
  runCount: number;
  /** Quatre mots par item : rang paginé, instances statiques, base de table, sommets par instance. */
  draws: Uint32Array;
  /** Un bit par item : zéro pour l'item que le tronc rejette, qui n'étale aucune instance. */
  keep: Uint32Array;
  /** Les instances que la compaction a gardées par item paginé, et sa liste d'entrées. */
  itemCounts: Uint32Array;
  instances: Uint32Array;
  /** Les sommets d'une grappe paginée, et le pas d'adressage des instances. */
  maxVertexWords: number;
  vertexShift: number;
  /** Où la passe étale ses instances, et où elle écrit ses arguments : deux régions par passe. */
  instanceBase: number;
  argsBase: number;
  /** Les sorties : deux mots par instance, quatre mots d'argument indirect par tranche. */
  expanded: Uint32Array;
  args: Uint32Array;
};

/** Le tronc a-t-il gardé cet item ? Un bit par item, écrit par le classement de l'image. */
export const itemKept = (keep: Uint32Array, item: number) =>
  (keep[item >>> 5] & (1 << (item & 31))) !== 0;

/**
 * Étale le plan trié en une liste d'instances et un argument indirect par tranche.
 *
 * Une instance dit deux choses : l'item qui la porte, et ce qu'elle dessine — l'entrée de table
 * d'une grappe paginée, le premier indice de son morceau pour une primitive qui ne l'est pas. La
 * liste suit l'ordre du plan, donc l'ordre de peinture, et l'appel d'une tranche commence au sommet
 * `base << vertexShift` pour que le nuanceur y retrouve le rang de sa première instance.
 *
 * Rend le nombre d'instances écrites.
 */
export function expandBlendPlan(x: BlendExpansion) {
  const { order, runs, draws, keep, itemCounts, instances, expanded, args } = x;
  let cursor = x.instanceBase;
  for (let run = 0; run < x.runCount; run++) {
    const at = run * RUN_WORDS,
      first = runs[at],
      entries = runs[at + 1],
      owner = runOwner(order[first], entries),
      base = cursor;
    // Une tranche partagée dessine des grappes, toutes au pas de la table ; une tranche d'un seul
    // item non paginé dessine ses morceaux, au pas que sa géométrie lui a donné.
    const vertexCount =
      owner !== RUN_SHARED && draws[owner * 4] === DRAW_UNPAGED
        ? draws[owner * 4 + 3]
        : x.maxVertexWords;
    for (let k = 0; k < entries; k++) {
      const item = planItem(order[first + k]);
      if (!itemKept(keep, item)) continue;
      const paged = draws[item * 4];
      if (paged === DRAW_UNPAGED) {
        const words = draws[item * 4 + 3],
          morceaux = draws[item * 4 + 1];
        for (let j = 0; j < morceaux; j++) {
          expanded[cursor * 2] = item;
          expanded[cursor * 2 + 1] = j * words;
          cursor++;
        }
        continue;
      }
      const tableBase = draws[item * 4 + 2],
        tenues = itemCounts[paged];
      for (let j = 0; j < tenues; j++) {
        expanded[cursor * 2] = item;
        expanded[cursor * 2 + 1] = instances[tableBase + j];
        cursor++;
      }
    }
    const out = x.argsBase + run * 4;
    args[out] = vertexCount;
    args[out + 1] = cursor - base;
    args[out + 2] = base << x.vertexShift;
    args[out + 3] = 0;
  }
  return cursor - x.instanceBase;
}

/**
 * Le repli d'un appareil sans étage de calcul : la MÊME sémantique, écrite par le processeur.
 *
 * La coupe processeur a déjà rempli la liste d'instances et les comptes par item
 * (`webgpuBlendSelection.ts`) ; il ne reste qu'à étaler le plan des deux passes et à pousser les
 * deux régions écrites. Un item que le tronc rejette n'y met rien, exactement comme sur la carte.
 */
export function writeBlendExpansionCpu(
  blendState: ReturnType<typeof createWebgpuBlendState>,
  device: GPUDevice,
) {
  const { expandedBuffer, argsBuffer } = blendState;
  if (!expandedBuffer || !argsBuffer) return;
  // Les deux miroirs processeur n'existent QUE sur ce chemin : un appareil à étage de calcul ne
  // garde pas en mémoire vive une liste d'instances que la carte écrit toute seule.
  if (blendState.expandedPacked.length < blendState.instanceCapacity * 2)
    blendState.expandedPacked = new Uint32Array(blendState.instanceCapacity * 2);
  if (blendState.argsPacked.length < blendState.maxPlanEntries * 8)
    blendState.argsPacked = new Uint32Array(blendState.maxPlanEntries * 8);
  const { expandedPacked, argsPacked } = blendState;
  const orders = blendState.orders,
    bases = blendState.instanceBase;
  for (let pass = 0; pass < orders.length; pass++) {
    const written = expandBlendPlan({
      order: orders[pass],
      runs: blendState.runs[pass],
      runCount: blendState.runCount[pass],
      draws: blendState.drawsPacked,
      keep: blendState.keepPacked,
      itemCounts: blendState.cpuItemCounts,
      instances: blendState.cpuInstances,
      maxVertexWords: blendState.maxVertexWords,
      vertexShift: blendState.vertexShift,
      instanceBase: bases[pass],
      argsBase: blendState.planRegions[pass].args,
      expanded: expandedPacked,
      args: argsPacked,
    });
    const args = blendState.planRegions[pass].args;
    if (written)
      device.queue.writeBuffer(
        expandedBuffer,
        bases[pass] * 8,
        expandedPacked.buffer,
        bases[pass] * 8,
        written * 8,
      );
    // Seules les tranches de CETTE image sont poussées : quelques dizaines d'octets, là où un
    // argument par item en réécrivait quatre par item et par image.
    if (blendState.runCount[pass])
      device.queue.writeBuffer(
        argsBuffer,
        args * 4,
        argsPacked.buffer,
        args * 4,
        blendState.runCount[pass] * 16,
      );
  }
}
