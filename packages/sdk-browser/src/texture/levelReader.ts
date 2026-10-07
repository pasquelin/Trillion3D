import {
  PREVIEW_LOSSLESS_FORMAT,
  textureLevelUrl,
  type ClusterManifest,
  type TextureLevelFormat,
} from '../../../sdk-core/src/index.ts'
import { checked } from '../cluster/checked.ts'
import type { TextureLevelStore } from './levelStore.ts'
import { tiledLevelBytes } from './tileRecords.ts'

/** What an engine reads of a baked level: the image decoded by the browser, ready to copy —
 *  or, block-compressed, the bytes as the file holds them, which the GPU reads as they are. */
export type TextureLevel = ImageBitmap | Uint8Array
/** A level to read: its address, and the format the session samples. */
export type TextureLevelRequest = {
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
  /** A block level's bytes to read alone — one tile's record (`tileRecords.ts`) —, by an HTTP
   *  Range; a server that ignores it answers the whole file. */
  range?: { offset: number; bytes: number }
}
// The explorer's reader also names the store its session holds the levels in: its world's
// (`levelStore.ts`).
/** A function that fetches one baked texture level. */
export type TextureLevelReader = ((request: TextureLevelRequest) => Promise<TextureLevel>) & {
  readonly store?: TextureLevelStore
  /** The cook the reader was made for: its levels are held in `store` under it. */
  readonly key?: string
}

/** Host bytes a decoded bitmap of `width` × `height` texels holds. */
const bitmapBytes = (width: number, height: number) => width * height * 4
/** Host bytes a level holds: the bitmap's texels, or the blocks. */
export const textureLevelBytes = (level: TextureLevel) =>
  level instanceof Uint8Array ? level.byteLength : bitmapBytes(level.width, level.height)
/** Host bytes the whole level `request` names will hold once read, `width` × `height` texels. */
export const requestedLevelBytes = (
  { format }: TextureLevelRequest,
  [width, height]: readonly [number, number],
) =>
  format === PREVIEW_LOSSLESS_FORMAT ? bitmapBytes(width, height) : tiledLevelBytes(width, height)
export const closeTextureLevel = (level: TextureLevel) => {
  if (!(level instanceof Uint8Array)) level.close()
}

/**
 * Reader of a cache's baked levels, built by the explorer that knows the manifest address; the
 * engine itself only receives the function. A lossless level decodes as the browser does, off
 * the main thread, with exactly the options the prepared scene decodes its source images with
 * (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`, `../host/prepared/images.ts`): the
 * bytes that reach the atlas by this path are those that reached it by the other. A block level
 * is read as bytes — one tile's record by an HTTP Range, or the whole file —, whose length
 * `heldLevels.ts` checks. A cache whose levels are of another version is refused before
 * any read (`assertCacheIdentity`).
 *
 * Levels are kept in `store` under the cook's `key`, which hashes the source, its images, the
 * compiler and every option that decides the product: under one key a level names one file.
 * Another key's levels leave the store as this reader is made.
 */
export function createTextureLevelReader(
  { textures, key }: Pick<ClusterManifest, 'textures' | 'key'>,
  base: string,
  store?: TextureLevelStore,
  signal?: AbortSignal,
): TextureLevelReader | undefined {
  store?.keepOnly(key)
  if (!textures || typeof createImageBitmap !== 'function') return undefined
  const read = async ({
    sha256,
    atlas,
    level,
    format,
    url: direct,
    range,
  }: TextureLevelRequest) => {
    const url = new URL(direct ?? textureLevelUrl(textures.url, sha256, atlas, level, format), base)
      .href
    const headers = range && { Range: `bytes=${range.offset}-${range.offset + range.bytes - 1}` }
    const response = await checked(url, signal, undefined, headers)
    if (format === PREVIEW_LOSSLESS_FORMAT)
      return createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })
    return new Uint8Array(await response.arrayBuffer())
  }
  return Object.assign(read, { store, key })
}
