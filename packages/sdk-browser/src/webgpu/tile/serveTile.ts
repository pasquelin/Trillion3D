import { PREVIEW_LOSSLESS_FORMAT } from '../../../../sdk-core/src/texture/previewFormat.ts'
import { previewLevelSize } from '../../../../sdk-core/src/texture/previewLevels.ts'
import type { HeldLevels, LevelFailed } from '../../texture/heldLevels.ts'
import type { TextureLevelAddress } from '../../texture/levelReader.ts'
import type { PoolEncoding } from '../../texture/blockFormats.ts'
import { writeTileFromBlocks } from './writeBlocks.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
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
/** The sources whose levels are read through the held levels: a cooked chain, or level files. */
export type ReadSource = Extract<TileTexture['source'], { kind: 'baked' | 'files' }>

/** The file level `level` of `source` is read from: a cooked chain's, in the format its lane
 *  samples (`format`); a level file's own, at its own address, lossless. */
export function levelAddress(
  source: ReadSource,
  level: number,
  format: TextureLevelAddress['format'],
): TextureLevelAddress {
  if (source.kind === 'baked') return { sha256: source.sha256, atlas: source.atlas, level, format }
  const { sha256, url } = source.levels[level]
  return { sha256, atlas: 0, level, format: PREVIEW_LOSSLESS_FORMAT, url }
}

/** The pool a tile of `key` lands in, its level's size and its region in it. */
function tileTarget(atlas: WebgpuTileAtlas, key: TileKey) {
  const { layout } = atlas.textures[key.slot]
  const size = previewLevelSize(layout.width, layout.height, key.level)
  const region = tileRegion(size[0], size[1], key.tx, key.ty)
  return { pool: atlas.poolOf(key.slot).texture, size, region }
}

/** A read level's tile — a cooked chain's or a level file's (`levelAddress`) —, read through
 *  `levels`, written as its block record or its decoded bitmap; a failed read told `failed`. */
export function serveBaked(
  { device, encoding, failed }: { device: GPUDevice; encoding: PoolEncoding; failed: LevelFailed },
  levels: HeldLevels,
  source: ReadSource,
  { atlas, key }: TileAsk,
): Served {
  const { pool, size, region } = tileTarget(atlas, key)
  const lane = atlas.textures[key.slot].lane
  const address = levelAddress(source, key.level, encoding.levelFormat(lane))
  // A level that cannot fit beside the pages kept will not come: refused, not waited for.
  const roomFor = () => atlas.roomFor(key.slot)
  const held = levels.read(address, size, failed, key.tx, key.ty, roomFor)
  if (typeof held === 'string') return held
  const place = atlas.place(key)
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
  const place = atlas.place(key)
  if (!place) return 'refused'
  builds.read(id)
  const { pool, region } = tileTarget(atlas, key)
  copyTileFromTexture(encoder(), pool, place, scratch.texture, key.level, region)
  return 'served'
}
