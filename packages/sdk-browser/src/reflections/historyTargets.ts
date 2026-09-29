/** Dedicated rough-reflection history. The RGB mean and bounded confidence have
 * the HDR image's precision; previous receiver metadata preserves its input formats.
 * Metadata has one copy, updated only after the resolve finishes reading it. */
export const REFLECTION_HISTORY_BYTES_PER_PIXEL = 32;

export type ReflectionMetadata = {
  depth: GPUTexture;
  normal: GPUTexture;
  ids: GPUTexture;
};

export function createReflectionHistoryTargets(device: GPUDevice, width: number, height: number) {
  const textures: GPUTexture[] = [];
  const target = (label: string, format: GPUTextureFormat, copies = false) => {
    const texture = device.createTexture({
      label: `Trillion3D reflection ${label}`,
      size: { width, height },
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        (copies ? GPUTextureUsage.COPY_DST : GPUTextureUsage.RENDER_ATTACHMENT),
    });
    textures.push(texture);
    return { texture, view: texture.createView() };
  };
  try {
    const images = [target('history A', 'rgba16float'), target('history B', 'rgba16float')];
    const depth = target('previous depth', 'depth32float', true);
    const normal = target('previous normal and roughness', 'rgba16float', true);
    const ids = target('previous visibility', 'r32uint', true);
    let read = 0;
    let disposed = false;
    const live = () => {
      if (disposed) throw new Error('REFLECTION_HISTORY_DISPOSED');
    };
    return {
      width,
      height,
      bytes: width * height * REFLECTION_HISTORY_BYTES_PER_PIXEL,
      previous: { depth: depth.view, normal: normal.view, ids: ids.view },
      get image() {
        live();
        return images[read].view;
      },
      /** The callback encodes all consumers of the previous metadata. Copies follow
       * it in the same encoder; neither later queue writes nor another pass can move
       * them ahead of those reads. The opaque depth remains depth32float throughout. */
      resolve(
        encoder: GPUCommandEncoder,
        current: ReflectionMetadata,
        draw: (history: GPUTextureView, output: GPUTextureView) => void,
      ) {
        live();
        const write = 1 - read;
        draw(images[read].view, images[write].view);
        const size = { width, height, depthOrArrayLayers: 1 };
        encoder.copyTextureToTexture(
          { texture: current.depth, aspect: 'depth-only' },
          { texture: depth.texture, aspect: 'depth-only' },
          size,
        );
        encoder.copyTextureToTexture(
          { texture: current.normal },
          { texture: normal.texture },
          size,
        );
        encoder.copyTextureToTexture({ texture: current.ids }, { texture: ids.texture }, size);
        read = write;
        return images[read].view;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const texture of textures) texture.destroy();
      },
    };
  } catch (error) {
    for (const texture of textures) texture.destroy();
    throw error;
  }
}
