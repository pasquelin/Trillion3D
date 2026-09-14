import type * as THREE from 'three';
import { textureRgba } from './visibilityBuffer.ts';
import { clearWebgpuAtlasLayer, type TextureJob } from './webgpuAtlasCommon.ts';

/** Allocates the sRGB color atlas and queues each layer for progressive transfer. */
export function prepareWebgpuColorAtlas(
  device: GPUDevice,
  maps: THREE.Texture[],
  uvScales: Array<[number, number]>,
  textureJobs: TextureJob[],
) {
  let maxW = 1,
    maxH = 1;
  const rgbaMaps = maps.map((texture) => {
    const rgba = textureRgba(texture);
    if (rgba) {
      maxW = Math.max(maxW, rgba.width);
      maxH = Math.max(maxH, rgba.height);
    } else {
      const image = texture.image as { width?: number; height?: number } | undefined;
      if (image?.width && image.height) {
        maxW = Math.max(maxW, image.width);
        maxH = Math.max(maxH, image.height);
      }
    }
    return rgba;
  });
  const layers = Math.max(2, maps.length + 1);
  if (layers > device.limits.maxTextureArrayLayers)
    throw new Error(
      `TEXTURE_ATLAS_LAYERS: ${layers} texture layers exceed the device limit ${device.limits.maxTextureArrayLayers}`,
    );
  const mapsTexture = device.createTexture({
    size: { width: maxW, height: maxH, depthOrArrayLayers: layers },
    format: 'rgba8unorm-srgb',
    mipLevelCount: 1 + Math.floor(Math.log2(Math.max(maxW, maxH))),
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const fallbackEncoder = device.createCommandEncoder();
  for (let layer = 0; layer < layers; layer++)
    clearWebgpuAtlasLayer(fallbackEncoder, mapsTexture, layer, { r: 1, g: 1, b: 1, a: 1 });
  for (let i = 0; i < maps.length; i++) {
    const rgba = rgbaMaps[i],
      layer = i + 1;
    uvScales[layer] = [1, 1];
    if (rgba) {
      uvScales[layer] = [rgba.width / maxW, rgba.height / maxH];
      textureJobs.push({
        kind: 'color',
        layer,
        bytes: rgba.data.byteLength,
        upload: () => {
          device.queue.writeTexture(
            { texture: mapsTexture!, origin: [0, 0, layer] },
            Uint8Array.from(rgba.data),
            { bytesPerRow: rgba.width * 4, rowsPerImage: rgba.height },
            { width: rgba.width, height: rgba.height },
          );
        },
      });
    } else {
      const image = maps[i].image as GPUCopyExternalImageSource | undefined;
      if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
        throw new Error('MATERIAL_COLOR_TEXTURE_UNAVAILABLE');
      const w = 'width' in image ? (image as ImageBitmap).width : maxW,
        h = 'height' in image ? (image as ImageBitmap).height : maxH;
      uvScales[layer] = [w / maxW, h / maxH];
      textureJobs.push({
        kind: 'color',
        layer,
        bytes: w * h * 4,
        upload: () =>
          device.queue.copyExternalImageToTexture(
            { source: image },
            { texture: mapsTexture!, origin: [0, 0, layer] },
            [w, h],
          ),
      });
    }
  }
  return { mapsTexture, maxW, maxH, layers, fallbackEncoder };
}
