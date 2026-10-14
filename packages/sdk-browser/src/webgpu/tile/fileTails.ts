import { previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import type { HeldLevels, LevelFailed } from '../../texture/heldLevels.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
import { levelAddress, type ReadSource } from './serveTile.ts'
import { writeTailFromBitmaps } from './write.ts'

/**
 * THE TAILS OF LEVEL FILES (`files`, `tileTexture.ts`): a tail the sidecar does not carry, each of
 * its levels a file of its own. Asked by whoever needs the texture readable (`cardTiles.ts`), its
 * levels are read through the held levels as a tile's are; once every one of them is held, the
 * tail is pinned through the atlas's one tail pin (`pinTail`), as a tail in bytes is at prepare. The pool's floor holds it: the census counted it among the tails
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
  /** The tails asked since the last pin, per atlas. */
  const asked = new Map<WebgpuTileAtlas, Set<number>>()
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
  return {
    /** Asks `slot`'s tail for the next `pinAsked`. */
    ask(atlas: WebgpuTileAtlas, slot: number) {
      let slots = asked.get(atlas)
      if (!slots) asked.set(atlas, (slots = new Set()))
      slots.add(slot)
    },
    /** Pins the tails asked whose levels are all held, the others' reads launched; returns how
     *  many it pinned. The asks are spent: their askers ask again while they wait. */
    pinAsked() {
      let count = 0
      if (!levels) return count
      for (const [atlas, slots] of asked) {
        for (const slot of slots) {
          if (atlas.tailPinned(slot)) continue
          const bitmaps = heldTail(atlas, slot)
          if (!bitmaps) continue
          atlas.pinTail(slot, (pool, place) =>
            writeTailFromBitmaps(queue, pool.texture, place, bitmaps),
          )
          count++
        }
        slots.clear()
      }
      return count
    },
  }
}
