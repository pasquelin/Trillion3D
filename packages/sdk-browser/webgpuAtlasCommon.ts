export type TextureJob = {
  kind: 'color' | 'data';
  layer: number;
  bytes: number;
  upload: () => void;
};

export function clearWebgpuAtlasLayer(
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  layer: number,
  color: { r: number; g: number; b: number; a: number },
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
