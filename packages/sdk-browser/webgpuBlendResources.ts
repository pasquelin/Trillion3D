import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './webgpuBlendItems.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { createBlendExpand } from './webgpuBlendExpand.ts';
import { EXPAND_PASSES, planWords, scratchWords } from './webgpuBlendRuns.ts';
import { writeBlendExpansionCpu } from './webgpuBlendExpandCpu.ts';
import { writeVolumeRecords } from './webgpuTransmission.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Tout ce que la passe transparente tient de la SCENE, monte une fois : les fiches d'items,
 * l'uniforme de vue, les arguments indirects et le tronc GPU qui les ecrit.
 *
 * Rien ici ne depend de la camera. Ce qui depend de la scene — matrices, materiaux — se refait par
 * `refreshBlendScene`, et seulement quand la scene a bouge.
 */
export async function prepareBlendResources(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu;
  if (!items.length) return;
  // Un item pagine lit la geometrie concatenee, celle-la meme que la passe opaque : son premier
  // sommet y est le bloc de sa geometrie source.
  for (const item of items)
    item.vertexBase = item.paged
      ? (vis.geometryBlocks.get(item.sourceGeometry.attributes)?.vertexBase ?? 0)
      : 0;
  buildBlendStatics(blendState);
  // La liste transparente de la scene EST la liste de dessin : ce qu'une image en retire, elle le
  // retire par un compte d'instances nul, et les relevés continuent de nommer les items de la scene.
  blendState.visibleBlend.length = 0;
  for (const item of items) blendState.visibleBlend.push(item);
  blendState.itemPacked = new Float32Array(items.length * BLEND_ITEM_WORDS);
  blendState.itemInts = new Uint32Array(blendState.itemPacked.buffer);
  blendState.itemBuffer = device.createBuffer({
    label: 'WG blend item records',
    size: items.length * BLEND_ITEM_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  blendState.viewBuffer = device.createBuffer({
    label: 'WG blend view uniform',
    size: BLEND_VIEW_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // Les deux sorties de l'étalement : la liste d'instances que le nuanceur lit au rang que l'indice
  // de sommet lui donne, et un argument indirect par tranche. Elles appartiennent à la scène, et le
  // repli processeur les écrit lui-même quand l'appareil n'a pas d'étage de calcul.
  const entries = blendState.maxPlanEntries;
  refreshBlendScene(rt, device);
  blendState.expandedBuffer = device.createBuffer({
    label: 'WG blend expanded instances',
    size: blendState.instanceCapacity * 8,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  blendState.argsBuffer = device.createBuffer({
    label: 'WG blend indirect arguments',
    size: Math.max(16, entries * 16 * EXPAND_PASSES),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  blendState.expand = await createBlendExpand(
    device,
    { items: items.length, planWords: planWords(entries), scratchWords: scratchWords(entries) },
    {
      counts: blendState.compaction?.indirectBuffer,
      clusters: blendState.compaction?.instanceBuffer,
    },
    { expanded: blendState.expandedBuffer, args: blendState.argsBuffer },
  );
  blendState.expand?.uploadDraws(blendState.drawsPacked);
}

/**
 * Les fiches, les boites, les volumes et le plan d'encodage, refaits apres un changement de scene.
 *
 * C'est la SEULE boucle sur les items qui subsiste, et une camera qui bouge ne la declenche pas :
 * elle ne repart que sur un deplacement de matrice ou un montage de ressources.
 */
export function refreshBlendScene(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { blendState, vis } = rt,
    items = blendState.blendGpu,
    packed = blendState.itemPacked,
    ints = blendState.itemInts;
  if (!blendState.itemBuffer || !items.length) return;
  for (let i = 0; i < items.length; i++) writeBlendItemRecord(packed, ints, i, items[i], vis);
  device.queue.writeBuffer(
    blendState.itemBuffer,
    0,
    packed.buffer as ArrayBuffer,
    0,
    packed.byteLength,
  );
  refreshBlendPlan(blendState);
  writeVolumeRecords(rt, device);
}

/**
 * Ce que l'image demande à l'étalement : le verdict du tronc, l'ordre s'il a bougé, puis les deux
 * passes de noyaux, enchaînées dans UNE passe de calcul.
 *
 * Les lancements d'une même passe de calcul sont ordonnés et voient les écritures des précédents :
 * le mélange peut donc rendre sa mémoire de travail à la transmission, dont les instances et les
 * arguments vivent, eux, dans leurs propres régions. Sans étage de calcul, le processeur écrit
 * exactement les mêmes mots (`webgpuBlendExpandCpu.ts`).
 */
export function encodeBlendExpansion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { blendState } = rt,
    expand = blendState.expand;
  if (!expand) {
    writeBlendExpansionCpu(blendState, device);
    return;
  }
  if (blendState.keepMoved) {
    expand.uploadKeep(blendState.keepPacked);
    blendState.keepMoved = false;
  }
  const orders = blendState.orders;
  const pass = encoder.beginComputePass({ label: 'WG blend expansion' });
  for (let slice = 0; slice < orders.length; slice++) {
    const order = orders[slice],
      region = blendState.planRegions[slice];
    if (!order.length) continue;
    if (blendState.orderMoved[slice]) {
      expand.uploadPlan(region, order, blendState.runs[slice], blendState.runCount[slice]);
      blendState.orderMoved[slice] = false;
    }
    expand.encode(
      pass,
      slice,
      region,
      {
        entries: order.length,
        runs: blendState.runCount[slice],
        instanceBase: blendState.instanceBase[slice],
      },
      blendState,
    );
  }
  pass.end();
}
