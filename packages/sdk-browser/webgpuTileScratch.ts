import type * as THREE from 'three';
import type { TextureRgba } from './visibilityTypes.ts';
import { generateMaterialMips, mipLevelCountFor } from './textureMips.ts';

/**
 * La texture de travail d'une texture de l'hôte : la source entière, transférée une fois, et sa
 * chaîne de mips fabriquée par la carte avec la règle des matériaux (moyenne en couleur, médiane en
 * alpha). Les tuiles en sont ensuite copiées dans le pool, niveau par niveau.
 *
 * C'est le chemin d'une texture SANS chaîne cuite — celle qu'un hôte a décodée lui-même, ou une
 * scène d'essai qui donne ses texels en mémoire. Il coûte la source entière à chaque fois qu'une
 * tuile de cette texture manque, et c'est voulu : la mémoire graphique tenue reste celle du pool,
 * et le prix se paie en transfert, mesuré, jamais en octets résidents. La chaîne cuite du cache
 * est le chemin de la référence ; celui-ci n'existe que pour ne refuser aucune scène.
 */
export type TileScratch = { texture: GPUTexture; destroy(): void };

export function createTileScratch(
  device: GPUDevice,
  options: {
    map: THREE.Texture;
    rgba: TextureRgba | null;
    width: number;
    height: number;
    format: GPUTextureFormat;
    errorCode: string;
  },
): TileScratch {
  const { width, height, format, rgba } = options;
  const texture = device.createTexture({
    label: 'WG texture scratch',
    size: { width, height, depthOrArrayLayers: 1 },
    format,
    mipLevelCount: mipLevelCountFor(width, height),
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  if (rgba) {
    if (rgba.width !== width || rgba.height !== height) throw new Error('TEXTURE_SOURCE_SIZE');
    device.queue.writeTexture(
      { texture },
      rgba.data as Uint8Array<ArrayBuffer>,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height },
    );
  } else {
    const image = options.map.image as GPUCopyExternalImageSource | undefined;
    if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
      throw new Error(options.errorCode);
    device.queue.copyExternalImageToTexture({ source: image }, { texture }, [width, height]);
  }
  generateMaterialMips(device, texture, format, width, height, [[1, 1]]);
  return { texture, destroy: () => texture.destroy() };
}
