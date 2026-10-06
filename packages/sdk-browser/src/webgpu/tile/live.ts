import type { WebgpuTileAtlas } from './atlas.ts'
import type { TileTexture } from './tileTexture.ts'
import { levelSize } from '../../texture/tiles.ts'
import { sourceSize } from '../../texture/pictureSize.ts'
import { tailSlotOf, tileKeyOf } from './ids.ts'
import { copyTailFromTexture, copyTileFromTexture, tileRegion } from './write.ts'

/** True when a texture's source still has the size its tiles were laid out at; a cooked chain,
 *  read from the cache, always has. */
export function pictureFits({ layout, source }: TileTexture) {
  if (source.kind !== 'host') return true
  const [width, height] = sourceSize(source.map)
  return width === layout.width && height === layout.height
}

/**
 * A live texture's new picture, copied from its working texture into every place the texture
 * already holds (#362): its tail and each resident tile, at the level it serves, where they are —
 * read from the pool at copy time, since a pool resize moves them. Nothing is requested, evicted
 * or re-registered: the page table does not move, and no image shows a coarser level while the
 * tiles are copied again. One submit.
 */
export function copyLiveTexture(
  device: GPUDevice,
  atlas: WebgpuTileAtlas,
  slot: number,
  source: GPUTexture,
) {
  const encoder = device.createCommandEncoder({ label: 'Trillion3D live texture' })
  const { layout } = atlas.textures[slot]
  const pool = atlas.poolOf(slot)
  for (const index of pool.occupied()) {
    const id = pool.keyOf(index),
      tailOf = tailSlotOf(id)
    if (tailOf === undefined) {
      const { slot: owner, level, tx, ty } = tileKeyOf(id)
      if (owner !== slot) continue
      const [width, height] = levelSize(layout.width, layout.height, level)
      copyTileFromTexture(
        encoder,
        pool.texture,
        pool.placeOf(index),
        source,
        level,
        tileRegion(width, height, tx, ty),
      )
    } else if (tailOf === slot)
      copyTailFromTexture(
        encoder,
        pool.texture,
        pool.placeOf(index),
        source,
        [layout.width, layout.height],
        layout.tail,
        layout.last,
      )
  }
  device.queue.submit([encoder.finish()])
}
