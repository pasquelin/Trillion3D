import type * as THREE from 'three';
import { textureRgba } from './visibilityBuffer.ts';
import { mipLevelCountFor } from './textureMips.ts';

export type TextureJob = {
  kind: 'color' | 'data';
  layer: number;
  bytes: number;
  upload: () => void;
};

type AtlasFill = { r: number; g: number; b: number; a: number };

/** What distinguishes the sRGB colour atlas from the linear data atlas. */
export type AtlasSpec = {
  kind: TextureJob['kind'];
  format: GPUTextureFormat;
  fillFor: (layer: number) => AtlasFill;
  errorCode: string;
};

function clearWebgpuAtlasLayer(
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  layer: number,
  color: AtlasFill,
) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: texture.createView({
          dimension: '2d',
          baseArrayLayer: layer,
          arrayLayerCount: 1,
          baseMipLevel: 0,
          mipLevelCount: 1,
        }),
        clearValue: color,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.end();
}

/** Allocates one material atlas (layer 0 stays the fallback fill), clears every layer on `encoder`
 *  and queues each source texture for progressive transfer. */
export function prepareWebgpuAtlas(
  device: GPUDevice,
  maps: THREE.Texture[],
  uvScales: Array<[number, number]>,
  textureJobs: TextureJob[],
  encoder: GPUCommandEncoder,
  spec: AtlasSpec,
) {
  let width = 1,
    height = 1;
  const rgbaMaps = maps.map((texture) => {
    const rgba = textureRgba(texture);
    if (rgba) {
      width = Math.max(width, rgba.width);
      height = Math.max(height, rgba.height);
    } else {
      const image = texture.image as { width?: number; height?: number } | undefined;
      if (image?.width && image.height) {
        width = Math.max(width, image.width);
        height = Math.max(height, image.height);
      }
    }
    return rgba;
  });
  const layers = Math.max(2, maps.length + 1);
  if (layers > device.limits.maxTextureArrayLayers)
    throw new Error(
      `TEXTURE_ATLAS_LAYERS: ${layers} texture layers exceed the device limit ${device.limits.maxTextureArrayLayers}`,
    );
  const texture = device.createTexture({
    size: { width, height, depthOrArrayLayers: layers },
    format: spec.format,
    mipLevelCount: mipLevelCountFor(width, height),
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  for (let layer = 0; layer < layers; layer++)
    clearWebgpuAtlasLayer(encoder, texture, layer, spec.fillFor(layer));
  for (let i = 0; i < maps.length; i++) {
    const rgba = rgbaMaps[i],
      layer = i + 1;
    uvScales[layer] = [1, 1];
    if (rgba) {
      uvScales[layer] = [rgba.width / width, rgba.height / height];
      textureJobs.push({
        kind: spec.kind,
        layer,
        bytes: rgba.data.byteLength,
        upload: () => {
          device.queue.writeTexture(
            { texture, origin: [0, 0, layer] },
            Uint8Array.from(rgba.data),
            { bytesPerRow: rgba.width * 4, rowsPerImage: rgba.height },
            { width: rgba.width, height: rgba.height },
          );
        },
      });
    } else {
      const image = maps[i].image as GPUCopyExternalImageSource | undefined;
      if (!image || typeof device.queue.copyExternalImageToTexture !== 'function')
        throw new Error(spec.errorCode);
      const w = 'width' in image ? (image as ImageBitmap).width : width,
        h = 'height' in image ? (image as ImageBitmap).height : height;
      uvScales[layer] = [w / width, h / height];
      textureJobs.push({
        kind: spec.kind,
        layer,
        bytes: w * h * 4,
        upload: () =>
          device.queue.copyExternalImageToTexture(
            { source: image },
            { texture, origin: [0, 0, layer] },
            [w, h],
          ),
      });
    }
  }
  return { texture, width, height };
}
