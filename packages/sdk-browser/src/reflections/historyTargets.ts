/** Dedicated rough-reflection history. The RGB mean and bounded confidence have
 * the HDR image's precision; previous receiver metadata preserves its input formats.
 * Metadata has one copy, updated only after the resolve finishes reading it: the normal here, the
 * depth and identifiers the reflection source keeps for its own reprojection (`source.ts`). */
export const REFLECTION_HISTORY_BYTES_PER_PIXEL = 24;

export type ReflectionMetadata = {
  depth: GPUTexture;
  normal: GPUTexture;
  ids: GPUTexture;
};

/** The last image's depth and identifiers, the reflection source's copies (`source.ts`). */
export type ReflectionPrevious = { depth: GPUTextureView; ids: GPUTextureView };

export function createReflectionHistoryTargets(
  device: GPUDevice,
  width: number,
  height: number,
  kept: ReflectionPrevious,
) {
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
    const normal = target('previous normal and roughness', 'rgba16float', true);
    let read = 0;
    let disposed = false;
    const live = () => {
      if (disposed) throw new Error('REFLECTION_HISTORY_DISPOSED');
    };
    return {
      bytes: width * height * REFLECTION_HISTORY_BYTES_PER_PIXEL,
      previous: { depth: kept.depth, normal: normal.view, ids: kept.ids },
      get image() {
        live();
        return images[read].view;
      },
      /** The callback encodes all consumers of the previous normal. Its copy follows
       * it in the same encoder; neither later queue writes nor another pass can move
       * it ahead of those reads. */
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
          { texture: current.normal },
          { texture: normal.texture },
          size,
        );
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
