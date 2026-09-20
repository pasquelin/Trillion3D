import {
  levelBlockBytes,
  previewLevelSize,
  textureLevelUrl,
  type TextureLevelFormat,
} from '../sdk-core/index.ts';
import { checked } from './clusterPages.ts';

/** A baked level in a block format: its bytes, whole 4×4 blocks row-major, and its texel size. */
export type TextureLevelBlocks = { blocks: Uint8Array; width: number; height: number };
/** What an engine reads of a baked level: the image decoded by the browser, ready to copy —
 *  or, block-compressed, the bytes as the file holds them, which the GPU reads as they are. */
export type TextureLevel = ImageBitmap | TextureLevelBlocks;
/** A level to read: its address, the format the session samples, and the source dimensions
 *  the level's own follow from. */
export type TextureLevelRequest = {
  sha256: string;
  atlas: number;
  level: number;
  format: TextureLevelFormat;
  width: number;
  height: number;
};
export type TextureLevelReader = (request: TextureLevelRequest) => Promise<TextureLevel>;

/** Host bytes a level holds: the bitmap's texels, or the blocks. */
export const textureLevelBytes = (level: TextureLevel) =>
  'blocks' in level ? level.blocks.byteLength : level.width * level.height * 4;
export const closeTextureLevel = (level: TextureLevel) => {
  if (!('blocks' in level)) level.close();
};

/**
 * Reader of a cache's baked levels, built by the explorer that knows the manifest address; the
 * engine itself only receives the function. A lossless level decodes
 * as the browser does, off the main thread, with exactly the options Three's glTF loader uses
 * for the source image (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`): the bytes
 * that reach the atlas by this path are those that reached it by the other. A block level is
 * read as bytes and checked against the length its dimensions imply — a file that is short or
 * long is refused, never copied as if it were whole.
 */
export function createTextureLevelReader(
  textures: { url: string } | undefined,
  base: string,
  signal?: AbortSignal,
): TextureLevelReader | undefined {
  if (!textures || typeof createImageBitmap !== 'function') return undefined;
  return async ({ sha256, atlas, level, format, ...source }) => {
    const url = new URL(textureLevelUrl(textures.url, sha256, atlas, level, format), base).href;
    const response = await checked(url, signal);
    if (format === 'png')
      return createImageBitmap(await response.blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
    const [width, height] = previewLevelSize(source.width, source.height, level);
    const blocks = new Uint8Array(await response.arrayBuffer());
    if (blocks.byteLength !== levelBlockBytes(width, height))
      throw new Error(`TEXTURE_LEVEL_BYTES ${url}: ${blocks.byteLength}`);
    return { blocks, width, height };
  };
}
