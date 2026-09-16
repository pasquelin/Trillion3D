import { BLEND_ITEM_WORDS, writeBlendItemRecord } from './webgpuBlendItems.ts';
import { BLEND_VIEW_SIZE } from './webgpuBlendUniforms.ts';
import { buildBlendStatics, refreshBlendPlan } from './webgpuBlendPlan.ts';
import { createBlendArgsBuffer } from './webgpuBlendArgs.ts';
import { createBlendSelect } from './webgpuBlendSelect.ts';
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
  blendState.argsBuffer = createBlendArgsBuffer(device, items.length);
  refreshBlendScene(rt, device);
  blendState.select = await createBlendSelect(
    device,
    items.length,
    blendState.compaction?.indirectBuffer,
    blendState.argsBuffer,
  );
  blendState.select?.uploadDraws(blendState.drawsPacked);
  blendState.select?.uploadBoxes(blendState.boxesPacked);
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
  blendState.select?.uploadBoxes(blendState.boxesPacked);
  writeVolumeRecords(rt, device);
}
