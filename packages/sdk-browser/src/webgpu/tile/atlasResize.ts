import { POOL_LAYER_SIDE, TILE_PITCH } from '../../texture/tiles.ts';
import { createWebgpuTilePool, type TilePoolOptions, type WebgpuTilePool } from './pool.ts';
import type { WebgpuTilePageTable } from './pageTable.ts';
import { cellOrigin } from './write.ts';
import { tailSlotOf, tileKeyOf } from './ids.ts';

/**
 * An atlas pool changes layers WITHOUT losing what it holds — the reference, itself, empties its
 * virtual textures when their pool changes size. Surviving layers are copied in one command, slot
 * for slot: the page table does not move for them. Tiles of vanishing layers are moved into a free
 * slot of the new pool — the pinned tails first, then the most looked-at —, each copied and
 * re-registered in the table; what no longer fits is evicted, the table says so, `onEvicted` hears
 * its texture and the coarse level takes over. A tail always finds a place. Returns the new pool
 * and the evicted-tile count; the old pool is destroyed once the copy is submitted.
 */
export function resizeTileAtlas(
  device: Pick<GPUDevice, 'createTexture' | 'createCommandEncoder' | 'queue'>,
  options: TilePoolOptions,
  tap: number,
  pool: WebgpuTilePool,
  pages: WebgpuTilePageTable,
  resident: Map<number, number>,
  onEvicted?: (slot: number) => void,
): { pool: WebgpuTilePool; evicted: number } {
  const next = createWebgpuTilePool(device, options);
  const encoder = device.createCommandEncoder({
    label: `Trillion3D texture pool ${options.kind} ${options.lane} resize`,
  });
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
  // The pinned tiles — the tails, which the floor holds all of — first, then the most looked-at.
  const pinned = (index: number) => Number(pool.pinnedOf(index));
  displaced.sort((a, b) => pinned(b) - pinned(a) || pool.lastUseOf(b) - pool.lastUseOf(a));
  let evicted = 0,
    yielding: number[] | undefined,
    yielded = 0;
  const evict = (from: WebgpuTilePool, index: number) => {
    evictTile(from, index, { pages, resident }, onEvicted);
    evicted++;
  };
  for (const index of displaced) {
    const id = pool.keyOf(index),
      tail = tailSlotOf(id);
    let target = next.acquire(id, pool.lastUseOf(index), pool.pinnedOf(index));
    // A tail never leaves: the pool's floor holds every tail of its lane (`texturePoolFor`), so the
    // least looked-at streamed tile gives it its slot, and its coarse level takes over.
    if (target === undefined && tail !== undefined) {
      const streamed = (yielding ??= next.candidates(Infinity))[yielded++];
      if (streamed !== undefined) {
        evict(next, streamed);
        target = next.acquire(id, pool.lastUseOf(index), true);
      }
    }
    if (target === undefined) {
      evict(pool, index);
      continue;
    }
    const from = pool.placeOf(index),
      place = next.placeOf(target);
    encoder.copyTextureToTexture(
      { texture: pool.texture, origin: [...cellOrigin(from), from.layer] },
      { texture: next.texture, origin: [...cellOrigin(place), place.layer] },
      [TILE_PITCH, TILE_PITCH, 1],
    );
    if (tail !== undefined) pages.setTail(tail, place, tap);
    else {
      resident.set(id, target);
      pages.setTile(tileKeyOf(id), place);
    }
  }
  device.queue.submit([encoder.finish()]);
  pool.destroy();
  return { pool: next, evicted };
}

/** Gives the streamed tile at `index` of `pool` back: the table and `resident` forget it, and
 *  `onEvicted` hears its texture, for whoever reads it to follow. */
export function evictTile(
  pool: WebgpuTilePool,
  index: number,
  table: { pages: Pick<WebgpuTilePageTable, 'clearTile'>; resident: Map<number, number> },
  onEvicted?: (slot: number) => void,
) {
  const id = pool.keyOf(index),
    key = tileKeyOf(id);
  table.pages.clearTile(key);
  table.resident.delete(id);
  pool.release(index);
  onEvicted?.(key.slot);
}
