// Oracle du lot F, côté textures : `visibilityTypes.ts:129-142` d'avant le lot F, recopié tel quel.

/** `textureRgba` avant le lot F : une vue et un objet alloués à chaque texel échantillonné. */
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
