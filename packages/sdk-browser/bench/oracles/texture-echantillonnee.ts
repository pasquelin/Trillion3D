// Batch F oracle, texture side: `visibilityTypes.ts:129-142` from before batch F, copied as-is.
import type * as THREE from 'three';

/** `textureRgba` before batch F: a view and an object allocated on every sampled texel. */
export function referenceTextureRgba(texture: THREE.Texture) {
  const image = texture.image;
  if (!image?.data || !image.width || !image.height) return null;
  const src = image.data;
  return {
    data: new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    width: image.width,
    height: image.height,
  };
}
