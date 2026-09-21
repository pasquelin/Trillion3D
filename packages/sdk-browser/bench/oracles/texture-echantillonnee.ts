// Batch F oracle, texture side: `visibilityTypes.ts:129-142` from before batch F, copied as-is.

/** `textureRgba` before batch F: a view and an object allocated on every sampled texel. */
export function referenceTextureRgba(texture) {
  const image = texture.image;
  if (!image?.data || !image.width || !image.height) return null;
  const src = image.data;
  return {
    data: new Uint8Array(src.buffer, src.byteOffset, src.byteLength),
    width: image.width,
    height: image.height,
  };
}
