import { previewLevelSize } from '../../../../sdk-core/src/index.ts'
import type { HeldLevels, LevelFailed } from '../../texture/heldLevels.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { tailId } from './ids.ts'
import { levelAddress, type ReadSource } from './serveTile.ts'
import { writeTailFromBitmaps } from './write.ts'

/**
 * THE TAILS OF LEVEL FILES (`files`, `tileTexture.ts`): a tail the sidecar does not carry, each of
 * its levels a file of its own. Asked by whoever needs the texture readable (`cardTiles.ts`), its
 * levels are read through the held levels as a tile's are; once every one of them is held, the
 * tail is written in a place pinned for good and the table names it, as `pinTails` pins a tail in
 * bytes at prepare. The pool's floor holds it: the census counted it among the tails
 * (`laneTails`). A tail asked and not yet whole is read again when it is asked again; one asked no
 * more is let be. Until pinned, its texture is read by nobody: its asker waits for it.
 */
export function createFileTails(options: {
  queue: GPUQueue
  levels: HeldLevels | undefined
  encoding: PoolEncoding
  failed: LevelFailed
}) {
  const { queue, levels, encoding, failed } = options
  /** The slots whose tail is pinned, per atlas; the tails asked since the last pin. */
  const pinned = new Map<WebgpuTileAtlas, Set<number>>()
  const asked = new Map<WebgpuTileAtlas, Set<number>>()
  const setOf = (sets: typeof pinned, atlas: WebgpuTileAtlas) => {
    let set = sets.get(atlas)
    if (!set) sets.set(atlas, (set = new Set()))
    return set
  }
  /** The levels of `slot`'s tail once all are held; none while one is read — every one of them
   *  asked at once, so they land together. */
  const heldTail = (atlas: WebgpuTileAtlas, slot: number) => {
    const { layout, source } = atlas.textures[slot]
    const bitmaps: ImageBitmap[] = []
    let whole = true
    for (let level = layout.tail; level <= layout.last; level++) {
      const address = levelAddress(source as ReadSource, level, encoding.levelFormat('lossless'))
      const held = levels!.read(
        address,
        previewLevelSize(layout.width, layout.height, level),
        failed,
      )
      if (typeof held === 'string') whole = false
      else bitmaps.push(held as ImageBitmap)
    }
    return whole ? bitmaps : undefined
  }
  /** `slot`'s tail written in a pinned place of its lane's pool, the table naming it. */
  const pin = (atlas: WebgpuTileAtlas, slot: number, bitmaps: readonly ImageBitmap[]) => {
    const pool = atlas.poolOf(slot)
    // The floor holds every tail (`texturePoolFor`): a pool drawn under it refuses by name.
    const index = pool.acquire(tailId(slot), true)
    if (index === undefined) throw new Error('TEXTURE_POOL_UNDER_FLOOR')
    const place = pool.placeOf(index)
    writeTailFromBitmaps(queue, pool.texture, place, bitmaps)
    atlas.pages.setTail(slot, place, encoding.tapOf(atlas.textures[slot].lane))
    setOf(pinned, atlas).add(slot)
  }
  return {
    /** Whether `slot`'s tail is pinned in `atlas`. */
    pinned: (atlas: WebgpuTileAtlas, slot: number) => pinned.get(atlas)?.has(slot) ?? false,
    /** Asks `slot`'s tail for the next `pinAsked`. */
    ask: (atlas: WebgpuTileAtlas, slot: number) => void setOf(asked, atlas).add(slot),
    /** Pins the tails asked whose levels are all held, the others' reads launched; returns how
     *  many it pinned. The asks are spent: their askers ask again while they wait. */
    pinAsked() {
      let count = 0
      if (!levels) return count
      for (const [atlas, slots] of asked) {
        for (const slot of slots) {
          if (pinned.get(atlas)?.has(slot)) continue
          const bitmaps = heldTail(atlas, slot)
          if (!bitmaps) continue
          pin(atlas, slot, bitmaps)
          count++
        }
        slots.clear()
      }
      return count
    },
  }
}
