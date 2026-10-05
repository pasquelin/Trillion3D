/** Dedicated rough-reflection history. The RGB mean and bounded confidence have
 * the HDR image's precision, the root mean square of its samples' brightest channel binary16
 * (`resolveWgsl.ts`); previous receiver metadata preserves its input formats.
 * Metadata has one copy, updated only after the resolve finishes reading it: the normal here, the
 * depth and identifiers the reflection source keeps for its own reprojection (`source.ts`). Beside
 * them, the trace's records of its half-resolution texels' pixels, which the resolve reads. */
const REFLECTION_HISTORY_BYTES_PER_PIXEL = 28;
/** The trace's record of a half-resolution texel's pixel: its identifier and depth (`sampleWgsl.ts`). */
const REFLECTION_OWNER_BYTES = 8;
const halfOf = (size: number) => Math.ceil(size / 2);

/** Bytes of a rough history of `width × height`: its targets, and the trace's records, one a
 *  half-resolution texel. */
export const reflectionHistoryBytes = (width: number, height: number) =>
  width * height * REFLECTION_HISTORY_BYTES_PER_PIXEL +
  halfOf(width) * halfOf(height) * REFLECTION_OWNER_BYTES;

export type ReflectionMetadata = {
  depth: GPUTexture;
  normal: GPUTexture;
  ids: GPUTexture;
};

/** The last image's depth and identifiers, the reflection source's copies (`source.ts`). */
export type ReflectionPrevious = { depth: GPUTextureView; ids: GPUTextureView };

/** Targets of `width × height` a reflection pass draws into, or copies into (`copies`), each
 *  held in `textures` for one destruction; the history's and the source's (`source.ts`). */
export function reflectionTargets(device: GPUDevice, width: number, height: number) {
  const textures: GPUTexture[] = [];
  return {
    textures,
    target: (label: string, format: GPUTextureFormat, copies = false) => {
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
    },
  };
}

export function createReflectionHistoryTargets(
  device: GPUDevice,
  width: number,
  height: number,
  kept: ReflectionPrevious,
) {
  const { textures, target } = reflectionTargets(device, width, height);
  try {
    const images = [target('history A', 'rgba16float'), target('history B', 'rgba16float')];
    const moments = [target('moment A', 'r16float'), target('moment B', 'r16float')];
    const normal = target('previous normal and roughness', 'rgba16float', true);
    // The trace writes them, the resolve reads them (`sampleWgsl.ts`, `resolveWgsl.ts`).
    const owners = device.createTexture({
      label: 'Trillion3D reflection trace owners',
      size: { width: halfOf(width), height: halfOf(height) },
      format: 'rg32uint',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    textures.push(owners);
    let read = 0;
    let disposed = false;
    const live = () => {
      if (disposed) throw new Error('REFLECTION_HISTORY_DISPOSED');
    };
    return {
      bytes: reflectionHistoryBytes(width, height),
      previous: { depth: kept.depth, normal: normal.view, ids: kept.ids },
      owners: owners.createView(),
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
        draw: (
          history: GPUTextureView,
          output: GPUTextureView,
          moment: { held: GPUTextureView; output: GPUTextureView },
        ) => void,
      ) {
        live();
        const write = 1 - read;
        draw(images[read].view, images[write].view, {
          held: moments[read].view,
          output: moments[write].view,
        });
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
