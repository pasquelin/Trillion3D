import type * as THREE from 'three';
import { textureRgba } from './visibilityBuffer.ts';
import { clearWebgpuAtlasLayer, type TextureJob } from './webgpuAtlasCommon.ts';

/** Allocates the linear data atlas and queues each layer for progressive transfer. */
export function prepareWebgpuDataAtlas(
  device: GPUDevice,
  dataMaps: THREE.Texture[],
  normalMaps: Set<THREE.Texture>,
  dataUvScales: Array<[number, number]>,
  textureJobs: TextureJob[],
  fallbackEncoder: GPUCommandEncoder,
) {
  let dataW = 1,
    dataH = 1;
  const rgbaData = dataMaps.map((texture) => {
    const rgba = textureRgba(texture);
    if (rgba) {
      dataW = Math.max(dataW, rgba.width);
      dataH = Math.max(dataH, rgba.height);
    } else {
      const image = texture.image as { width?: number; height?: number } | undefined;
      if (image?.width && image.height) {
        dataW = Math.max(dataW, image.width);
        dataH = Math.max(dataH, image.height);
      }
    }
    return rgba;
  });
  const dataLayers = Math.max(2, dataMaps.length + 1);
  if (dataLayers > device.limits.maxTextureArrayLayers)
    throw new Error(
      `TEXTURE_ATLAS_LAYERS: ${dataLayers} texture layers exceed the device limit ${device.limits.maxTextureArrayLayers}`,
    );
  const dataMapsTexture = device.createTexture({
    size: { width: dataW, height: dataH, depthOrArrayLayers: dataLayers },
    format: 'rgba8unorm',
    mipLevelCount: 1 + Math.floor(Math.log2(Math.max(dataW, dataH))),
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  for (let layer = 0; layer < dataLayers; layer++)
    clearWebgpuAtlasLayer(
      fallbackEncoder,
      dataMapsTexture,
      layer,
      normalMaps.has(dataMaps[layer - 1])
        ? { r: 128 / 255, g: 128 / 255, b: 1, a: 1 }
        : { r: 1, g: 1, b: 1, a: 1 },
    );
  device.queue.submit([fallbackEncoder.finish()]);
  for (let i = 0; i < dataMaps.length; i++) {
    const rgba = rgbaData[i],
      layer = i + 1;
    dataUvScales[layer] = [1, 1];
    if (rgba) {
      dataUvScales[layer] = [rgba.width / dataW, rgba.height / dataH];
      textureJobs.push({
        kind: 'data',
        layer,
        bytes: rgba.data.byteLength,
        upload: () => {
          device.queue.writeTexture(
            { texture: dataMapsTexture!, origin: [0, 0, layer] },
            Uint8Array.from(rgba.data),
            { bytesPerRow: rgba.width * 4, rowsPerImage: rgba.height },
            { width: rgba.width, height: rgba.height },
          );
        },
      });
    } else {
      const image = dataMaps[i].image as GPUCopyExternalImageSource | undefined;
      if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
        throw new Error('MATERIAL_DATA_TEXTURE_UNAVAILABLE');
      const w = 'width' in image ? (image as ImageBitmap).width : dataW,
        h = 'height' in image ? (image as ImageBitmap).height : dataH;
      dataUvScales[layer] = [w / dataW, h / dataH];
      textureJobs.push({
        kind: 'data',
        layer,
        bytes: w * h * 4,
        upload: () =>
          device.queue.copyExternalImageToTexture(
            { source: image },
            { texture: dataMapsTexture!, origin: [0, 0, layer] },
            [w, h],
          ),
      });
    }
  }
  return { dataMapsTexture, dataW, dataH };
}
