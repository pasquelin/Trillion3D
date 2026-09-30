/** GPU-ready 4 × 4 blocks. The container's pixel codec is preserved; no RGBA expansion. */
export type CompressedImage = {
  width: number;
  height: number;
  blockFormat: string;
  mipmaps: readonly { width: number; height: number; data: ArrayBufferView }[];
};

/** Compressed pictures are recognized by their explicit encoding, never by a pixel buffer. */
export function compressedImage(image: unknown): CompressedImage | undefined {
  if (!image || typeof image !== 'object' || !('blockFormat' in image)) return undefined;
  return image as CompressedImage;
}
