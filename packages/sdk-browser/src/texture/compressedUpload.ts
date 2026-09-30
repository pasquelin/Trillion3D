import type { CompressedImage } from '../../../sdk-core/src/texture/compressed.ts';

import { compressedBlockInfo } from './compressedFormats.ts';

/** Whether the current GPU accepts this native block format. */
export function supportsCompressed(
  features: { has(name: GPUFeatureName): boolean } | undefined,
  format: string,
) {
  const block = compressedBlockInfo(format);
  return !!block && !!features?.has(block[0]);
}

/** Shared container validation before either cache admission or a GPU allocation. */
export function validateCompressed(image: CompressedImage, maxDimension = Number.MAX_SAFE_INTEGER) {
  const block = compressedBlockInfo(image.blockFormat);
  if (!block) throw new Error('TEXTURE_BLOCK_FORMAT_UNSUPPORTED');
  const { width, height, mipmaps } = image;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Array.isArray(mipmaps) ||
    !mipmaps.length ||
    width > maxDimension ||
    height > maxDimension ||
    mipmaps.length > 1 + Math.floor(Math.log2(Math.max(width, height)))
  )
    throw new Error('TEXTURE_BLOCK_DIMENSIONS');
  for (let level = 0; level < mipmaps.length; level++) {
    const mip = mipmaps[level],
      w = Math.max(1, Math.floor(width / 2 ** level)),
      h = Math.max(1, Math.floor(height / 2 ** level));
    if (
      mip.width !== w ||
      mip.height !== h ||
      !ArrayBuffer.isView(mip.data) ||
      !(mip.data.buffer instanceof ArrayBuffer) ||
      mip.data.byteLength !== Math.ceil(w / 4) * Math.ceil(h / 4) * block[1]
    )
      throw new Error('TEXTURE_BLOCK_LENGTH');
  }
  return block;
}

/** Writes the original bytes directly to native GPU blocks. */
export function uploadCompressed(device: GPUDevice, image: CompressedImage, srgb: boolean) {
  if (!supportsCompressed(device.features, image.blockFormat))
    throw new Error('TEXTURE_BLOCK_FORMAT_UNSUPPORTED');
  const block = validateCompressed(image, device.limits.maxTextureDimension2D);
  const base = image.blockFormat.replace(/-srgb$/, '');
  const { width, height, mipmaps } = image;
  // The physical base extent is whole blocks; the caller retains the logical pixel extent.
  const color = !base.startsWith('bc4-') && !base.startsWith('bc5-') && !base.startsWith('eac-');
  const format = `${base}${srgb && color ? '-srgb' : ''}` as GPUTextureFormat;
  const texture = device.createTexture({
    label: 'Trillion3D source compressed blocks',
    format,
    size: [Math.ceil(width / 4) * 4, Math.ceil(height / 4) * 4],
    mipLevelCount: mipmaps.length,
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
  });
  try {
    for (let level = 0; level < mipmaps.length; level++) {
      const mip = mipmaps[level],
        columns = Math.ceil(mip.width / 4),
        rows = Math.ceil(mip.height / 4);
      device.queue.writeTexture(
        { texture, mipLevel: level },
        new Uint8Array(mip.data.buffer as ArrayBuffer, mip.data.byteOffset, mip.data.byteLength),
        { bytesPerRow: columns * block[1], rowsPerImage: rows },
        [columns * 4, rows * 4],
      );
    }
    return texture;
  } catch (error) {
    texture.destroy();
    throw error;
  }
}
