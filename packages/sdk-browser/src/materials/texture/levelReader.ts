import {
  textureLevelUrl,
  type TextureLevelFormat,
} from '../../../../sdk-core/src/texture/levelUrl.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import { ONE_REQUEST } from '../../geometry/cluster/checked.ts'
import type { PageCache } from '../../geometry/streaming/pageCache.ts'
import { decodeBlocksOffThread } from '../../geometry/work/host.ts'
import { recordRange, RECORD_END_BYTES, tileRecord } from './tileRecords.ts'

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
   *  (`streamingNumRetries`); negative, without end; absent, none is given up. */
  readonly retries?: () => number
}

/** A tile's bytes once read: its blocks, or four bytes a texel of its whole blocks decoded. */
export const tileLevelBytes = (blockBytes: number, rgba: boolean | undefined) =>
  rgba ? blockBytes * 4 : blockBytes

/** Raw DEFLATE bytes inflated by the browser's own decompressor: no decoder downloaded. */
async function inflateRaw(bytes: ArrayBuffer) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
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
 * failed — a head that failed is asked again with the next tile — as many times as `retries`
 * allows. A cache whose levels are of another version is refused before any read
 * (`assertCacheIdentity`).
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
  /** A record's compressed bytes as its tile is read: inflated — and decoded off the main thread
   *  for the lossless lane. */
  const land = async (
    packed: ArrayBuffer,
    record: ReturnType<typeof tileRecord>,
    { rgba, format }: TextureLevelAddress,
  ) => {
    const blocks = await inflateRaw(packed)
    if (!rgba || blocks.byteLength !== record.bytes) return blocks
    const surface = {
      width: record.across * 4,
      height: record.down * 4,
      twoChannel: format === 'bc5',
    }
    return decodeBlocksOffThread(blocks, surface)
  }
  const read = async (request: TextureLevelRequest) => {
    const { size, tx, ty } = request,
      url = urlOf(request)
    const record = tileRecord(size[0], size[1], tx, ty)
    const range = recordRange(await headOf(url, record.count), record.count, record.index)
    return land(await cache.readRange(url, range.offset, range.bytes, options), record, request)
  }
  return Object.assign(read, { store: cache, key, retries })
}
