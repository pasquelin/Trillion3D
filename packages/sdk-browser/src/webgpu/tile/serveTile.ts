import { previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import type { HeldLevels, LevelFailed } from '../../texture/heldLevels.ts'
import type { TextureLevelAddress } from '../../texture/levelReader.ts'
import type { PoolEncoding, PoolLane } from '../../texture/blockFormats.ts'
import { writeTileFromBlocks } from './writeBlocks.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
import type { createScratches } from './scratchBuilds.ts'
import type { TileKey } from './pageTable.ts'
import type { TileTexture } from './tileTexture.ts'
import { copyTileFromTexture, tileRegion, writeTileDecoded } from './write.ts'

/** A tile served: `waiting`, its bytes are not there yet, it will come back; `refused`, the pool
 *  is full for this view, or the level does not fit beside the pages kept, nothing will come — and
 *  nothing was read for it. */
export type Served = 'served' | 'waiting' | 'refused'
/** The tile asked: its atlas, its key and the feedback frame that asked it. */
export type TileAsk = { atlas: WebgpuTileAtlas; key: TileKey; frame: number }
/** The sources whose levels are read through the held levels: a cooked chain. */
export type ReadSource = Extract<TileTexture['source'], { kind: 'baked' }>

/** The file level `level` of `source` is read from by its lane `lane`: the family's blocks in a
 *  block lane, the stored family's decoded to RGBA8 in the lossless one (`levelFormat`). */
export function levelAddress(
  source: ReadSource,
  level: number,
  lane: PoolLane,
  encoding: PoolEncoding,
): TextureLevelAddress {
  const format = encoding.levelFormat(lane, source.tail)
  const { sha256, atlas } = source
  return { sha256, atlas, level, format, rgba: lane === 'lossless' }
}

/** Each source's level addresses (`levelAddress`), by level: one object a level read the same way,
 *  which the held levels name once (`heldLevels.ts`) — a waiting tile asks every frame. */
const addresses = new WeakMap<ReadSource, Map<number, TextureLevelAddress>>()

/** `levelAddress`, the one kept for `source` and `level` while it reads the same file the same way. */
function heldAddress(source: ReadSource, level: number, lane: PoolLane, encoding: PoolEncoding) {
  let byLevel = addresses.get(source)
  if (!byLevel) addresses.set(source, (byLevel = new Map()))
  const held = byLevel.get(level)
  if (
    held &&
    held.rgba === (lane === 'lossless') &&
    held.format === encoding.levelFormat(lane, source.tail)
  )
    return held
  const made = levelAddress(source, level, lane, encoding)
  byLevel.set(level, made)
  return made
}

/** The pool a tile of `key` lands in, its level's size and its region in it. */
function tileTarget(atlas: WebgpuTileAtlas, key: TileKey) {
  const { layout } = atlas.textures[key.slot]
  const size = previewLevelSize(layout.width, layout.height, key.level)
  const region = tileRegion(size[0], size[1], key.tx, key.ty)
  return { pool: atlas.poolOf(key.slot).texture, size, region }
}

/** A read level's tile — a cooked chain's (`levelAddress`) —, read through
 *  `levels`, written as its block record or its decoded texels; a failed read told `failed`. */
export function serveBaked(
  { device, encoding, failed }: { device: GPUDevice; encoding: PoolEncoding; failed: LevelFailed },
  levels: HeldLevels,
  source: ReadSource,
  { atlas, key }: TileAsk,
): Served {
  const { pool, size, region } = tileTarget(atlas, key)
  const lane = atlas.textures[key.slot].lane
  const address = heldAddress(source, key.level, lane, encoding)
  // A level that cannot fit beside the pages kept will not come: refused, not waited for.
  const roomFor = () => atlas.roomFor(key.slot)
  const held = levels.read(address, size, failed, key.tx, key.ty, roomFor)
  if (typeof held === 'string') return held
  const place = atlas.place(key)
  if (!place) return 'refused'
  if (address.rgba) writeTileDecoded(device.queue, pool, place, held, region)
  else writeTileFromBlocks(device.queue, pool, place, held, region)
  return 'served'
}

/** A host texture's tile, copied from its working texture (`id`) in `encoder`: asked off the frame
 *  when none is held. */
export function serveHost(
  scratches: ReturnType<typeof createScratches>,
  id: number,
  { atlas, key, frame }: TileAsk,
  encoder: () => GPUCommandEncoder,
): Served {
  const scratch = scratches.get(id)
  if (!scratch) {
    scratches.ask(id, frame, atlas, key.slot)
    return 'waiting'
  }
  const place = atlas.place(key)
  if (!place) return 'refused'
  scratches.read(id)
  const { pool, region } = tileTarget(atlas, key)
  copyTileFromTexture(encoder(), pool, place, scratch.texture, key.level, region)
  return 'served'
}
