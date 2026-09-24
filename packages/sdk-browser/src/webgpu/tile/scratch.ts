import type { Texture } from '../../../../sdk-core/src/index.ts';
import { textureRgba } from '../../visibility/types.ts';
import { generateMaterialMips, mipLevelCountFor } from '../../texture/mips.ts';
import { writeRgba } from './write.ts';
import { textureBytesOf } from '../../gpu/core/deviceLedger.ts';

/**
 * Working texture of a host texture: the whole source, transferred once, and its mip chain built
 * by the GPU with the materials rule (mean in colour, median in alpha). Tiles are then copied
 * into the pool, level by level.
 *
 * This is the path of a texture WITHOUT a cooked chain — one a host decoded itself, or a test
 * scene that gives its texels in memory. It costs the whole source every time a tile of that
 * texture is missing, and that is intended: GPU memory held stays that of the pool, and the
 * price is paid in transfer, measured, never in resident bytes. The cache's cooked chain is the
 * reference path; this one exists only so that no scene is refused. A LIVE texture — one whose
 * picture moved since the session opened: a video, a canvas redrawn — keeps its working texture,
 * one of its own size, refilled in place at each new picture (`fill`, #362).
 */
export type TileScratch = {
  texture: GPUTexture;
  /** Bytes it holds, mips included (`textureBytesOf`). */
  bytes: number;
  /** Writes the source's current picture again, mips included: what a live texture keeps. */
  fill(): void;
  destroy(): void;
};

export function createTileScratch(
  device: GPUDevice,
  options: {
    map: Texture;
    width: number;
    height: number;
    format: GPUTextureFormat;
    errorCode: string;
  },
): TileScratch {
  const { width, height, format } = options;
  const descriptor: GPUTextureDescriptor = {
    label: 'Trillion3D texture scratch',
    size: { width, height, depthOrArrayLayers: 1 },
    format,
    mipLevelCount: mipLevelCountFor(width, height),
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  };
  const texture = device.createTexture(descriptor);
  /** Sends the picture as it is now and builds its mips again, in the same texture. */
  const fill = () => {
    const rgba = textureRgba(options.map);
    if (rgba) {
      if (rgba.width !== width || rgba.height !== height) throw new Error('TEXTURE_SOURCE_SIZE');
      writeRgba(device.queue, texture, [0, 0, 0], rgba.data, width, height);
    } else {
      const image = options.map.image as GPUCopyExternalImageSource | undefined;
      if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
        throw new Error(options.errorCode);
      device.queue.copyExternalImageToTexture({ source: image }, { texture }, [width, height]);
    }
    generateMaterialMips(device, texture, format, width, height);
  };
  fill();
  return {
    texture,
    bytes: textureBytesOf(descriptor) ?? 0,
    fill,
    destroy: () => texture.destroy(),
  };
}
