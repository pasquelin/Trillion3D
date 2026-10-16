import { POOL_LAYER_SIDE, TILE_PITCH } from '../../texture/tiles.ts'
import { createWebgpuTilePool, type TilePoolOptions, type WebgpuTilePool } from './pool.ts'
import type { WebgpuTilePageTable } from './pageTable.ts'
import { cellOrigin } from './write.ts'
import { tailSlotOf, tileKeyOf } from './ids.ts'
import { pendingMade } from '../../gpu/core/tableGrowth.ts'

/**
 * An atlas pool changes layers WITHOUT losing what it holds. The new pool keeps the pinned places
 * first — every tail, wherever a late pin put it —, then the most looked-at by the GPU's queue, as
 * many as it holds; the others are evicted wherever they sat, the table says so, `onEvicted` hears
 * their texture and the coarse level takes over. Surviving layers are copied in one command, slot
 * for slot: the page table does not move for them; a kept tile of a vanishing layer is moved into a
 * free slot, copied and re-registered in the table. A tail never leaves: only a pool drawn under
 * its tails' floor, which `texturePoolFor` never draws, refuses by name, before anything moves.
 * Returns the new pool and the evicted-tile count. The one growth transaction
 * (`../../gpu/core/tableGrowth.ts`): the new pool made first — the device asked for it beforehand
 * (`grantedTexturePool`), a refusal here throws with the pool in place and its table untouched —,
 * then copied, put in place, and the old pool retired: destroyed after the frame's submit, which
 * may name it (`../../gpu/core/frameRetire.ts`).
 */
export function resizeTileAtlas(
  device: GPUDevice,
  options: TilePoolOptions,
  tap: number,
  pool: WebgpuTilePool,
  pages: WebgpuTilePageTable,
  resident: Map<number, number>,
  onEvicted?: (slot: number) => void,
): { pool: WebgpuTilePool; evicted: number } {
  const next = createWebgpuTilePool(device, options)
  let evicted = 0
  pendingMade(device, [next], next.bytes, () => {
    evicted = moveTiles(device, options, tap, { pool, next, pages, resident }, onEvicted)
    return [pool]
  }).commit()
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
  // What the new pool keeps: every pinned place, then by the GPU's queue from its far end — a place
  // it does not list, read of late, before any it does, and the last victim before the first —
  // as many as its tiles hold; the rest is evicted, wherever it sat.
  const pinned = (index: number) => Number(pool.pinnedOf(index))
  const lastOut = (index: number) => pool.rankOf(index) ?? Number.MAX_SAFE_INTEGER
  const order = pool.occupied().sort((a, b) => pinned(b) - pinned(a) || lastOut(b) - lastOut(a))
  // The floor keeps every pinned place (`texturePoolFor`): only a pool drawn under it refuses one.
  if (order.length > next.tiles && pool.pinnedOf(order[next.tiles]))
    throw new Error('TEXTURE_POOL_UNDER_FLOOR')
  const keep = order.slice(0, next.tiles),
    displaced: number[] = []
  let evicted = 0
  for (const index of order.slice(next.tiles)) {
    evictTile(pool, index, { pages, resident }, onEvicted)
    evicted++
  }
  // Kept in place where its layer survives; moved into a free place of the new pool otherwise.
  for (const index of keep) {
    if (index < next.tiles) next.adopt(index, pool.keyOf(index), pool.pinnedOf(index))
    else displaced.push(index)
  }
  for (const index of displaced) {
    const id = pool.keyOf(index),
      tail = tailSlotOf(id),
      target = next.acquire(id, pool.pinnedOf(index))!
    const from = pool.placeOf(index),
      place = next.placeOf(target)
    encoder.copyTextureToTexture(
      { texture: pool.texture, origin: [...cellOrigin(from), from.layer] },
      { texture: next.texture, origin: [...cellOrigin(place), place.layer] },
      [TILE_PITCH, TILE_PITCH, 1],
    )
    resident.set(id, target)
    if (tail !== undefined) pages.setTail(tail, place, tap)
    else pages.setTile(tileKeyOf(id), place)
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
