import { textureLevelUrl } from '../sdk-core/index.ts';
import { checked } from './clusterPages.ts';

/** What an engine reads of a baked level: the image decoded by the browser, ready to copy. */
export type TextureLevelReader = (
  sha256: string,
  atlas: number,
  level: number,
) => Promise<ImageBitmap>;

/**
 * Reader of a cache's baked levels, built by the explorer that knows the manifest
 * address; the engine itself only receives the function. Decode is the browser's, off
 * the main thread, with exactly the options Three's glTF loader uses for the source
 * image (`premultiplyAlpha: 'none'`, `colorSpaceConversion: 'none'`): the bytes that reach
 * the atlas by this path are those that reached it by the other.
 */
export function createTextureLevelReader(
  textures: { url: string } | undefined,
  base: string,
  signal?: AbortSignal,
): TextureLevelReader | undefined {
  if (!textures || typeof createImageBitmap !== 'function') return undefined;
  return async (sha256, atlas, level) => {
    const url = new URL(textureLevelUrl(textures.url, sha256, atlas, level), base).href;
    const blob = await (await checked(url, signal)).blob();
    return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  };
}
