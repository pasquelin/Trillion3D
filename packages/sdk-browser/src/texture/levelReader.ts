import {
  textureLevelUrl,
  type ClusterManifest,
  type TextureLevelFormat,
} from '../../../sdk-core/src/index.ts'
import { checked, ONE_REQUEST } from '../cluster/checked.ts'
import type { PageCache } from '../streaming/pageCache.ts'

/** What an engine reads of a baked level: the image decoded by the browser, ready to copy —
 *  or, block-compressed, the bytes as the file holds them, which the GPU reads as they are. */
export type TextureLevel = ImageBitmap | Uint8Array
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
  /** The level's own address, when the cache lists one — an impostor atlas level
   *  (`maps.<name>.levels[k].url`). Read through this same reader, resolved against `base`,
   *  in place of the `textures.url` template: one loader, one budget. */
  url?: string
}
/** A level to read: a lossless level whole, or, with its `range`, one tile's record of a block
 *  level (`tileRecords.ts`) by an HTTP Range — a block level is read by its tiles' records alone. */
export type TextureLevelRequest = TextureLevelAddress & {
  /** The tile's record in the level file, by its first byte and its length; absent, the level
   *  is read whole. */
  range?: { offset: number; bytes: number }
}
/** Where the levels read are held: the page cache, among its entries (`PageCache.level`), each
 *  held there by its asker while it must not leave (`acquire`, `release`, then `fit`). */
export type TextureLevelStore = Pick<
  PageCache,
  'level' | 'keepLevel' | 'roomBytes' | 'levelBytes' | 'acquire' | 'release' | 'fit'
>
/** A function that fetches one baked texture level, the store its levels are held in and the cook
 *  it was made for (`heldLevels.ts`). */
export type TextureLevelReader = ((request: TextureLevelRequest) => Promise<TextureLevel>) & {
  readonly store: TextureLevelStore
  /** The cook the reader was made for: its levels are held in `store` under it. */
  readonly key: string
}

/** Host bytes a decoded bitmap of `width` × `height` texels holds. */
export const bitmapBytes = (width: number, height: number) => width * height * 4
/** Host bytes a level holds: the bitmap's texels, or the blocks. */
export const textureLevelBytes = (level: TextureLevel) =>
  level instanceof Uint8Array ? level.byteLength : bitmapBytes(level.width, level.height)
export const closeTextureLevel = (level: TextureLevel) => {
  if (!(level instanceof Uint8Array)) level.close()
}

/**
 * Reader of a cache's baked levels, built by the explorer that knows the manifest address; the
 * engine itself only receives the function. A lossless level is read whole, by one request, and
 * decodes as the browser does, off the main thread, with exactly the options the prepared scene
 * decodes its source images with (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`,
 * `../host/prepared/images.ts`): the bytes that reach the atlas by this path are those that reached
 * it by the other. A block level is read by one tile's record at a time, by the page cache's
 * `readRange` (`PageCache.readRange`, which keeps the file a server answers whole). A read fails
 * once, never asked again here: `heldLevels.ts` checks each record and holds back what failed. A
 * cache whose levels are of another version is refused before any read (`assertCacheIdentity`).
 *
 * Levels are held in `cache` under the cook's `key`, which hashes the source, its images, the
 * compiler and every option that decides the product: under one key a level names one file.
 */
export function createTextureLevelReader(
  { textures, key }: Pick<ClusterManifest, 'textures' | 'key'>,
  base: string,
  cache: Pick<PageCache, 'readRange'> & TextureLevelStore,
  signal?: AbortSignal,
): TextureLevelReader | undefined {
  if (!textures || typeof createImageBitmap !== 'function') return undefined
  const read = async (request: TextureLevelRequest) => {
    const { sha256, atlas, level, format, range } = request
    const own = request.url ?? textureLevelUrl(textures.url, sha256, atlas, level, format)
    const url = new URL(own, base).href
    if (range) {
      const bytes = await cache.readRange(url, range.offset, range.bytes, {
        attempts: ONE_REQUEST,
        signal,
      })
      return new Uint8Array(bytes)
    }
    const response = await checked(url, signal, ONE_REQUEST)
    return createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
  }
  return Object.assign(read, { store: cache, key })
}
