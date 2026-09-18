import { mipLevelCountFor } from './textureMips.ts';
import type { AtlasClassPlan } from './webgpuAtlasClasses.ts';
import type { AtlasClassTexture } from './webgpuAtlasCommon.ts';

type AtlasFill = { r: number; g: number; b: number; a: number };

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

/**
 * Alloue une texture-tableau par classe du plan, avec sa chaîne de mips entière, et efface chaque
 * couche sur `encoder` avec le remplissage que `fillFor` nomme. Sortie de `webgpuAtlasCommon.ts`
 * pour tenir la limite de lignes du dépôt, sans rien changer à ce qui est alloué.
 */
export function allocateAtlasClasses(
  device: GPUDevice,
  plan: AtlasClassPlan,
  format: GPUTextureFormat,
  encoder: GPUCommandEncoder,
  fillFor: (classIndex: number, layer: number) => AtlasFill,
): AtlasClassTexture[] {
  return plan.sizes.map(([width, height], index) => {
    const layers = plan.layers[index];
    const texture = device.createTexture({
      label: `WG material atlas ${format} classe ${index}`,
      size: { width, height, depthOrArrayLayers: layers },
      format,
      mipLevelCount: mipLevelCountFor(width, height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (let layer = 0; layer < layers; layer++)
      clearWebgpuAtlasLayer(encoder, texture, layer, fillFor(index, layer));
    return {
      texture,
      view: texture.createView({ dimension: '2d-array' }),
      size: [width, height] as [number, number],
      layers,
      bytes: plan.bytes[index],
      scales: Array.from({ length: layers }, () => [1, 1] as [number, number]),
    };
  });
}
