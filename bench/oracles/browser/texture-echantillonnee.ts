// Batch F oracle, texture side: `visibilityTypes.ts:129-142` from before batch F, copied as-is.
import type { Texture } from '../../../packages/sdk-core/src/index.ts';

/** `textureRgba` before batch F: a view and an object allocated on every sampled texel. */
export function referenceTextureRgba(texture: Texture) {
  const image = texture.image as
    { data?: ArrayBufferView; width?: number; height?: number } | undefined;
  if (!image?.data || !image.width || !image.height) return null;
  const src = image.data;
  return {
    data: new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    width: image.width,
    height: image.height,
  };
}
