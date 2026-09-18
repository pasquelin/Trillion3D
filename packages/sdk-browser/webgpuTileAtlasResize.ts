import { POOL_LAYER_SIDE, TILE_PITCH } from './textureTiles.ts';
import { createWebgpuTilePool, type WebgpuTilePool } from './webgpuTilePool.ts';
import type { WebgpuTilePageTable } from './webgpuTilePageTable.ts';
import { cellOrigin } from './webgpuTileWrite.ts';
import { tailSlotOf, tileKeyOf } from './webgpuTileIds.ts';

/**
 * Le pool d'un atlas change de couches SANS perdre ce qu'il tient — la référence, elle, vide ses
 * textures virtuelles quand leur pool change de taille. Les couches qui survivent sont copiées en
 * une commande, place pour place : la table de pages ne bouge pas pour elles. Les tuiles des couches
 * qui disparaissent sont déplacées dans une place libre du nouveau pool — les queues épinglées
 * d'abord, puis les plus regardées —, chacune copiée sur la carte et réinscrite dans la table ; ce
 * qui n'y tient plus est évincé, la table le dit et le niveau grossier reprend. Rend le nouveau
 * pool et le compte des tuiles évincées ; l'ancien pool est détruit une fois la copie soumise.
 */
export function resizeTileAtlas(
  device: Pick<GPUDevice, 'createTexture' | 'createCommandEncoder' | 'queue'>,
  options: { kind: 'color' | 'data'; format: GPUTextureFormat; layers: number },
  pool: WebgpuTilePool,
  pages: WebgpuTilePageTable,
  resident: Map<number, number>,
): { pool: WebgpuTilePool; evicted: number } {
  const next = createWebgpuTilePool(device, options);
  const encoder = device.createCommandEncoder({ label: `WG texture pool ${options.kind} resize` });
  const kept = Math.min(pool.layers, next.layers);
  encoder.copyTextureToTexture({ texture: pool.texture }, { texture: next.texture }, [
    POOL_LAYER_SIDE,
    POOL_LAYER_SIDE,
    kept,
  ]);
  const displaced: number[] = [];
  for (const index of pool.occupied()) {
    const id = pool.keyOf(index);
    if (index < next.tiles)
      next.adopt(index, id, pool.lastUseOf(index), tailSlotOf(id) !== undefined);
    else displaced.push(index);
  }
  const pinned = (index: number) => Number(pool.pinnedOf(index));
  displaced.sort((a, b) => pinned(b) - pinned(a) || pool.lastUseOf(b) - pool.lastUseOf(a));
  let evicted = 0;
  for (const index of displaced) {
    const id = pool.keyOf(index),
      tail = tailSlotOf(id),
      target = next.acquire(id, pool.lastUseOf(index), pool.pinnedOf(index));
    if (target === undefined) {
      if (tail !== undefined) throw new Error('TEXTURE_POOL_TAILS');
      pages.clearTile(tileKeyOf(id));
      resident.delete(id);
      evicted++;
      continue;
    }
    const from = pool.placeOf(index),
      place = next.placeOf(target);
    encoder.copyTextureToTexture(
      { texture: pool.texture, origin: [...cellOrigin(from), from.layer] },
      { texture: next.texture, origin: [...cellOrigin(place), place.layer] },
      [TILE_PITCH, TILE_PITCH, 1],
    );
    if (tail !== undefined) pages.setTail(tail, place);
    else {
      resident.set(id, target);
      pages.setTile(tileKeyOf(id), place);
    }
  }
  device.queue.submit([encoder.finish()]);
  pool.destroy();
  return { pool: next, evicted };
}
