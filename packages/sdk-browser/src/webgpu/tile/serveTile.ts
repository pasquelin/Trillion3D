import { levelSize } from '../../texture/tiles.ts'
import { readHeldLevel, type HeldLevels } from '../../texture/heldLevels.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import { writeTileFromBlocks } from './writeBlocks.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import type { TileScratch } from './scratch.ts'
import type { createScratchBuilds } from './scratchBuilds.ts'
import type { TileKey } from './pageTable.ts'
import type { TileTexture } from './tileTexture.ts'
import { copyTileFromTexture, tileRegion, writeTileFromBitmap } from './write.ts'

/** A tile served: `waiting`, its bytes are not there yet, it will come back; `refused`, the pool
 *  is full for this view, or the level does not fit beside the pages kept, nothing will come — and
 *  nothing was read for it. */
export type Served = 'served' | 'waiting' | 'refused'
/** The tile asked: its atlas, its key and the feedback frame that asked it. */
export type TileAsk = { atlas: WebgpuTileAtlas; key: TileKey; frame: number }
type Baked = Extract<TileTexture['source'], { kind: 'baked' }>

/** The pool a tile of `key` lands in, its level's size and its region in it. */
function tileTarget(atlas: WebgpuTileAtlas, key: TileKey) {
  const { layout } = atlas.textures[key.slot]
  const size = levelSize(layout.width, layout.height, key.level)
  const region = tileRegion(size[0], size[1], key.tx, key.ty)
  return { pool: atlas.poolOf(key.slot).texture, size, region }
}

/** A cooked level's tile, read in the level store, written as its block record or its decoded
 *  bitmap. */
export function serveBaked(
  device: GPUDevice,
  levels: HeldLevels | undefined,
  encoding: PoolEncoding,
  source: Baked,
  { atlas, key, frame }: TileAsk,
): Served {
  const { pool, size, region } = tileTarget(atlas, key)
  const levelKey = {
    sha256: source.sha256,
    atlas: source.atlas,
    level: key.level,
    format: encoding.levelFormat(atlas.textures[key.slot].lane),
  }
  // A level that cannot fit beside the pages kept will not come: refused, not waited for.
  const roomFor = () => atlas.roomFor(key.slot, frame)
  if (!levels) return roomFor() ? 'waiting' : 'refused'
  const held = readHeldLevel(levels, levelKey, frame, size, key.tx, key.ty, roomFor)
  if (typeof held === 'string') return held
  const place = atlas.place(key, frame)
  if (!place) return 'refused'
  if (held instanceof Uint8Array) writeTileFromBlocks(device.queue, pool, place, held, region)
  else writeTileFromBitmap(device.queue, pool, place, held, region)
  return 'served'
}

/** A host texture's tile, copied from its working texture `scratch` (`id`) in `encoder`: asked off
 *  the frame when none is held. */
export function serveHost(
  builds: ReturnType<typeof createScratchBuilds>,
  scratch: TileScratch | undefined,
  id: number,
  { atlas, key, frame }: TileAsk,
  encoder: () => GPUCommandEncoder,
): Served {
  if (!scratch) {
    builds.ask(id, frame, atlas, key.slot)
    return 'waiting'
  }
  const place = atlas.place(key, frame)
  if (!place) return 'refused'
  builds.read(id)
  const { pool, region } = tileTarget(atlas, key)
  copyTileFromTexture(encoder(), pool, place, scratch.texture, key.level, region)
  return 'served'
}
