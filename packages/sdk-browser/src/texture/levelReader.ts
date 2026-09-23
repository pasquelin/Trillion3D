import {
  PREVIEW_LOSSLESS_FORMAT,
  textureLevelUrl,
  type TextureLevelFormat,
} from '../../../sdk-core/src/index.ts';
import { checked } from '../cluster/pages.ts';

/** What an engine reads of a baked level: the image decoded by the browser, ready to copy —
 *  or, block-compressed, the bytes as the file holds them, which the GPU reads as they are. */
export type TextureLevel = ImageBitmap | Uint8Array;
/** A level to read: its address, and the format the session samples. */
export type TextureLevelRequest = {
  sha256: string;
  atlas: number;
  level: number;
  format: TextureLevelFormat;
};
export type TextureLevelReader = (request: TextureLevelRequest) => Promise<TextureLevel>;

/** Host bytes a level holds: the bitmap's texels, or the blocks. */
export const textureLevelBytes = (level: TextureLevel) =>
  level instanceof Uint8Array ? level.byteLength : level.width * level.height * 4;
export const closeTextureLevel = (level: TextureLevel) => {
  if (!(level instanceof Uint8Array)) level.close();
};

/**
 * Reader of a cache's baked levels, built by the explorer that knows the manifest address; the
 * engine itself only receives the function. A lossless level decodes as the browser does, off
 * the main thread, with exactly the options Three's glTF loader uses for the source image
 * (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`): the bytes that reach the atlas
 * by this path are those that reached it by the other. A block level is read as bytes; the
 * write that cuts tiles from it checks their length against the level's geometry.
 */
export function createTextureLevelReader(
  textures: { url: string } | undefined,
  base: string,
  signal?: AbortSignal,
): TextureLevelReader | undefined {
  if (!textures || typeof createImageBitmap !== 'function') return undefined;
  return async ({ sha256, atlas, level, format }) => {
    const url = new URL(textureLevelUrl(textures.url, sha256, atlas, level, format), base).href;
    const response = await checked(url, signal);
    if (format === PREVIEW_LOSSLESS_FORMAT)
      return createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
    return new Uint8Array(await response.arrayBuffer());
  };
}
