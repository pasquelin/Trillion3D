import { POOL_LAYER_SIDE, TILE_PITCH } from '../../texture/tiles.ts'
import { createWebgpuTilePool, type TilePoolOptions, type WebgpuTilePool } from './pool.ts'
import type { WebgpuTilePageTable } from './pageTable.ts'
import { cellOrigin } from './write.ts'
import { tailSlotOf, tileKeyOf } from './ids.ts'
import { pendingMade } from '../../gpu/core/tableGrowth.ts'

/**
 * An atlas pool changes layers WITHOUT losing what it holds. Surviving layers are copied in one
 * command, slot for slot: the page table does not move for them. Tiles of vanishing layers are moved into a free
 * slot of the new pool — pinned queues first, then the most looked-at —, each copied and
 * re-registered in the table; what no longer fits is evicted, the table says so, `onEvicted` hears
 * its texture and the coarse level takes over. A tail never leaves: only a pool drawn under its
 * tails' floor, which `texturePoolFor` never draws, displaces one, and refuses by name.
 * Returns the new pool and the evicted-tile count. The one growth transaction
 * (`../../gpu/core/tableGrowth.ts`): the new pool made first — the device asked for it beforehand
 * (`grantedTexturePool`), a refusal here throws with the pool in place and its table untouched —,
 * then copied, put in place, and the old pool destroyed once the copy is submitted.
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
  const next = createWebgpuTilePool(device, options)
  let evicted = 0
  pendingMade(
    next,
    next.bytes,
    (held) => held.destroy(),
    () => {
      evicted = moveTiles(device, options, tap, { pool, next, pages, resident }, onEvicted)
      return pool
    },
  ).commit()
  return { pool: next, evicted }
}

/** Copies what `pool` holds into `next` and moves its table to it (`resizeTileAtlas`); the tiles
 *  evicted. */
function moveTiles(
  device: Pick<GPUDevice, 'createCommandEncoder' | 'queue'>,
  options: TilePoolOptions,
  tap: number,
  { pool, next, pages, resident }: Moved,
  onEvicted?: (slot: number) => void,
) {
  const encoder = device.createCommandEncoder({
    label: `Trillion3D texture pool ${options.kind} ${options.lane} resize`,
  })
  const kept = Math.min(pool.layers, next.layers)
  encoder.copyTextureToTexture({ texture: pool.texture }, { texture: next.texture }, [
    POOL_LAYER_SIDE,
    POOL_LAYER_SIDE,
    kept,
  ])
  const displaced: number[] = []
  for (const index of pool.occupied()) {
    const id = pool.keyOf(index)
    if (index < next.tiles)
      next.adopt(index, id, pool.lastUseOf(index), tailSlotOf(id) !== undefined)
    else displaced.push(index)
  }
  const pinned = (index: number) => Number(pool.pinnedOf(index))
  displaced.sort((a, b) => pinned(b) - pinned(a) || pool.lastUseOf(b) - pool.lastUseOf(a))
  let evicted = 0
  for (const index of displaced) {
    const id = pool.keyOf(index),
      tail = tailSlotOf(id),
      target = next.acquire(id, pool.lastUseOf(index), pool.pinnedOf(index))
    if (target === undefined) {
      // The tails hold the lowest places, pinned first into a fresh pool, and the floor keeps them
      // all (`texturePoolFor`): only a pool drawn under it displaces one, never cleared as a tile.
      if (tail !== undefined) throw new Error('TEXTURE_POOL_UNDER_FLOOR')
      evictTile(pool, index, { pages, resident }, onEvicted)
      evicted++
      continue
    }
    const from = pool.placeOf(index),
      place = next.placeOf(target)
    encoder.copyTextureToTexture(
      { texture: pool.texture, origin: [...cellOrigin(from), from.layer] },
      { texture: next.texture, origin: [...cellOrigin(place), place.layer] },
      [TILE_PITCH, TILE_PITCH, 1],
    )
    if (tail !== undefined) pages.setTail(tail, place, tap)
    else {
      resident.set(id, target)
      pages.setTile(tileKeyOf(id), place)
    }
  }
  device.queue.submit([encoder.finish()])
  return evicted
}

/** The pool moved, the one it moves to, and the table and the resident tiles that follow. */
type Moved = {
  pool: WebgpuTilePool
  next: WebgpuTilePool
  pages: WebgpuTilePageTable
  resident: Map<number, number>
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
    key = tileKeyOf(id)
  table.pages.clearTile(key)
  table.resident.delete(id)
  pool.release(index)
  onEvicted?.(key.slot)
}
