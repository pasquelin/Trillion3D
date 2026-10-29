import {
  textureLevelUrl,
  type TextureLevelFormat,
} from '../../../../sdk-core/src/texture/levelUrl.ts'
import type { PageTaskBlocks } from '../../../../sdk-core/src/page/taskContracts.ts'
import { PREVIEW_HALF_FILE } from '../../../../sdk-core/src/texture/previewFormat.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { ONE_REQUEST } from '../../geometry/cluster/checked.ts'
import { inflateRaw } from '../../geometry/cluster/inflateRaw.ts'
import type { PageCache } from '../../geometry/streaming/pageCache.ts'
import { decodeBlocksOffThread } from '../../geometry/work/host.ts'
import { cellOf, recordRange, RECORD_END_BYTES, tileRecord } from './tileRecords.ts'
import { convertTexels, FILE_TEXELS, TEXEL_BYTES, type TexelKind } from './floatTexels.ts'

/** What an engine reads of a baked level: one tile's blocks as the GPU reads them — or, for a
 *  pool of the lossless lane, those blocks decoded to RGBA8 in a page worker (`blockDecode.ts`,
 *  `decodeBlocksOffThread`). */
export type TextureLevel = Uint8Array
/** Where a level lies: its address, and the format the session samples. */
export type TextureLevelAddress = {
  /** Fingerprint of the source image. */
  sha256: string
  /** Which atlas. */
  atlas: number
  /** Which level. */
  level: number
  /** Which format. */
  format: TextureLevelFormat
  /** Decoded to RGBA8 — the lossless lane's read of the stored family's blocks. */
  rgba?: boolean
  /** The pools made of texels read this: the kind of texel they hold, a level file's own texels
   *  converted to it (`floatTexels.ts`) — eight-bit in the one-channel pool, 16 or 32 bits in the
   *  float pools, half-float or 32-bit in the half-float lane. Absent in a block lane and the
   *  lossless one. */
  texels?: TexelKind
}
/** A level to read: one tile's record of a block level (`tileRecords.ts`), the level `size`
 *  texels wide and high. */
export type TextureLevelRequest = TextureLevelAddress & {
  size: readonly [width: number, height: number]
  tx: number
  ty: number
}
/** Where the levels read are held: the page cache, among its entries (`PageCache.level`), the
 *  least recently read leaving first. */
export type TextureLevelStore = Pick<PageCache, 'level' | 'keepLevel' | 'roomBytes' | 'levelBytes'>
/** A function that fetches one tile of a baked texture level, the store its levels are held in and
 *  the cook it was made for (`heldLevels.ts`). */
export type TextureLevelReader = ((request: TextureLevelRequest) => Promise<TextureLevel>) & {
  readonly store: TextureLevelStore
  /** The cook the reader was made for: its levels are held in `store` under it. */
  readonly key: string
  /** How many times a read that failed is tried again before it is given up, read at each failure
   *  (`streamingNumRetries`); negative, without end; absent, `DEFAULT_STREAMING_NUM_RETRIES`. */
  readonly retries?: () => number
}

/**
 * A tile's bytes once read, from its record's: the same bytes in a block lane; else the texels of
 * the kind the pool takes (`rgba8` for the lossless lane, `r8` for the one-channel pool, a float
 * kind for the float pools, half-float for the half-float lane), whole blocks wide — BC4's blocks
 * hold half the bytes of a record's sixteen texels, so a texel of RGBA8 is eight a record byte.
 */
export const tileLevelBytes = (
  recordBytes: number,
  { format, rgba, texels }: Pick<TextureLevelAddress, 'format' | 'rgba' | 'texels'>,
) => {
  const kind = rgba ? 'rgba8' : texels
  if (!kind) return recordBytes
  const cell = cellOf(format)
  return (recordBytes / cell.bytes) * cell.side ** 2 * TEXEL_BYTES[kind]
}

/** A record's compressed bytes as its tile is read: inflated — and decoded off the main thread
 *  for the lossless lane. */
const land = async (
  packed: ArrayBuffer,
  record: ReturnType<typeof tileRecord>,
  { rgba, texels, format }: TextureLevelAddress,
) => {
  const blocks = await inflateRaw(packed)
  if (blocks.byteLength !== record.bytes) return blocks
  const surface = { width: record.across * 4, height: record.down * 4 }
  const decode = (rest: Omit<PageTaskBlocks, 'width' | 'height' | 'twoChannel'>) =>
    decodeBlocksOffThread(blocks, { ...surface, twoChannel: false, ...rest })
  // A float file's squares unpack into the pool's kind of texel, RGBA8 for the lossless lane.
  if (format in FILE_TEXELS)
    return decode({ codec: format as keyof typeof FILE_TEXELS, to: rgba ? 'rgba8' : texels })
  // Half-float texels widen where the pool holds 32-bit floats.
  if (format === PREVIEW_HALF_FILE)
    return texels === 'rgba32' ? convertTexels(blocks, 'rgba16', 'rgba32') : blocks
  // BC6H into a pool of half-float or float texels.
  if (format === 'bc6h' && texels) return decode({ codec: 'bc6h', to: texels })
  // The one-channel pools of eight-bit or float texels, and the lossless one, decode their blocks.
  const codec = format === 'bc4' || format === 'g8' || format === 'a8' ? format : undefined
  if (texels) return decode({ codec, single: true, to: texels })
  if (!rgba) return blocks
  return decodeBlocksOffThread(blocks, {
    ...surface,
    twoChannel: format === 'bc5',
    ...(codec ? { codec } : {}),
  })
}

/** The files whose heads a reader keeps, the least recently read leaving first: a level being cut
 *  keeps its own, and a scene of many textures holds no head of every level it ever read. */
const HEADS_KEPT = 1024

/**
 * Reader of a cache's baked levels, built by the explorer that knows the manifest address; the
 * engine itself only receives the function. A level is read by one tile's record at a time, by the
 * page cache's `readRange` (`PageCache.readRange`, which keeps the file a server answers whole):
 * the file's head of record ends first — once per file, kept among the last `HEADS_KEPT` read —, then the
 * record, inflated by the browser; for the lossless lane, decoded to RGBA8 off the main thread. A
 * read fails once, never asked again here: `heldLevels.ts` checks each record and holds back what
 * failed — a head that failed is asked again with the next tile. A cache whose levels are of
 * another version is refused before any read (`assertCacheIdentity`).
 *
 * Levels are held in `cache` under the cook's `key`, which hashes the source, its images, the
 * compiler and every option that decides the product: under one key a level names one file.
 */
export function createTextureLevelReader(
  { textures, key }: Pick<ClusterManifest, 'textures' | 'key'>,
  base: string,
  cache: Pick<PageCache, 'readRange'> & TextureLevelStore,
  signal?: AbortSignal,
  retries?: () => number,
): TextureLevelReader | undefined {
  if (!textures) return undefined
  const options = { attempts: ONE_REQUEST, signal }
  /** Each file's head, by address, the last read last: read once while kept (`HEADS_KEPT`). */
  const heads = new Map<string, Promise<Uint8Array>>()
  const headOf = (url: string, count: number) => {
    let head = heads.get(url)
    if (head) heads.delete(url)
    else {
      head = cache
        .readRange(url, 0, count * RECORD_END_BYTES, options)
        .then((b) => new Uint8Array(b))
      const asked = head
      head.catch(() => heads.get(url) === asked && heads.delete(url))
      if (heads.size >= HEADS_KEPT) heads.delete(heads.keys().next().value!)
    }
    heads.set(url, head)
    return head
  }
  const urlOf = ({ sha256, atlas, level, format }: TextureLevelAddress) =>
    new URL(textureLevelUrl(textures.url, sha256, atlas, level, format), base).href
  const read = async (request: TextureLevelRequest) => {
    const { size, tx, ty } = request,
      url = urlOf(request)
    const record = tileRecord(size[0], size[1], tx, ty, request.format)
    const range = recordRange(await headOf(url, record.count), record.count, record.index)
    return land(await cache.readRange(url, range.offset, range.bytes, options), record, request)
  }
  return Object.assign(read, { store: cache, key, retries })
}
