import type { WebgpuTileAtlas } from './atlas.ts'
import type { TileTexture } from './tileTexture.ts'
import { levelSize } from '../../texture/tiles.ts'
import { sourceSize } from '../../texture/pictureSize.ts'
import { tailSlotOf, tileKeyOf } from './ids.ts'
import { copyTailFromTexture, copyTileFromTexture, tileRegion } from './write.ts'
import type { TileScratch } from './scratch.ts'
import type { Build } from './scratchBuilds.ts'

/** True when a texture's source still has the size its tiles were laid out at; a cooked chain,
 *  read from the cache, always has. */
export function pictureFits({ layout, source }: TileTexture) {
  if (source.kind !== 'host') return true
  const [width, height] = sourceSize(source.map)
  return width === layout.width && height === layout.height
}

/**
 * A live texture's new picture, copied from its working texture into every place the texture
 * already holds: its tail and each resident tile, at the level it serves, where they are —
 * read from the pool at copy time, since a pool resize moves them. Nothing is requested, evicted
 * or re-registered: the page table does not move, and no image shows a coarser level while the
 * tiles are copied again. Encoded in `encoder`, after the picture's turn and mips: one submit.
 */
export function copyLiveTexture(
  encoder: GPUCommandEncoder,
  atlas: WebgpuTileAtlas,
  slot: number,
  source: GPUTexture,
) {
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
}

/** Working textures of the live host textures, kept from pass to pass, and their bytes (#362). */
export function liveScratches(device: GPUDevice, build: Build) {
  const live = new Map<number, TileScratch>()
  let bytes = 0
  return {
    get: (id: number) => live.get(id),
    get bytes() {
      return bytes
    },
    /** A new picture of host texture `slot` of `atlas`, its working texture `id` refilled — or
     *  built, the texture turning live —: its turn, its mips and its copies one submit. Its turn
     *  keeps its ring and words for the next picture (`TileScratch.rest`). */
    refresh(atlas: WebgpuTileAtlas, slot: number, id: number) {
      const encoder = device.createCommandEncoder({ label: 'Trillion3D live texture' })
      let scratch = live.get(id)
      if (scratch) scratch.fill(encoder)
      else {
        live.set(id, (scratch = build(atlas, slot, encoder)))
        bytes += scratch.bytes
        scratch.reduce(encoder)
      }
      copyLiveTexture(encoder, atlas, slot, scratch.texture)
      device.queue.submit([encoder.finish()])
      scratch.rest()
    },
    release(id: number) {
      const scratch = live.get(id)
      if (!scratch) return
      bytes -= scratch.bytes
      scratch.destroy()
      live.delete(id)
    },
    destroy() {
      for (const scratch of live.values()) scratch.destroy()
      live.clear()
    },
  }
}
