import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** How the shading binds a shadow depth texture: every layer of the pool, one array. */
export const SHADOW_ARRAY: GPUTextureBindingLayout = {
  sampleType: 'depth',
  viewDimension: '2d-array',
};

/** The shadow texture `texture` as the shading samples it: every layer of the pool, one array. */
export const arrayView = (texture: GPUTexture) => texture.createView({ dimension: '2d-array' });

/** One 2D view per layer of a shadow texture: what a pass draws a page into, or reads it from. */
export const layerViews = (texture: GPUTexture) =>
  Array.from({ length: texture.depthOrArrayLayers }, (_, layer) =>
    texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
  );

/** The render pass of each layer, over its depth `depths[l]` and colour `colours?.[l]`: made once. */
export const layerPasses = (label: string, depths: GPUTextureView[], colours?: GPUTextureView[]) =>
  depths.map((view, layer): GPURenderPassDescriptor => ({
    label,
    colorAttachments: colours ? [{ view: colours[layer], loadOp: 'load', storeOp: 'store' }] : [],
    depthStencilAttachment: { view, depthLoadOp: 'load', depthStoreOp: 'store' },
  }));

/**
 * The pool's texture, `layers × poolSide²` pages, made not taken: what the grant allots under its
 * out-of-memory check (`../../webgpu/residency/poolGrants.ts`). `COPY_SRC` is there only for the
 * proof: the host can reread the pool and compare its fingerprint between two runs. No frame pass
 * copies it: the pool keeps its size, its pages their place (`../../webgpu/shadow/poolSize.ts`).
 */
export const shadowPoolTexture = (device: GPUDevice, poolSide: number, layers: number) =>
  device.createTexture({
    label: 'Trillion3D shadow depth atlas v1',
    size: [poolSide * SHADOW_PAGE, poolSide * SHADOW_PAGE, layers],
    format: 'depth32float',
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
