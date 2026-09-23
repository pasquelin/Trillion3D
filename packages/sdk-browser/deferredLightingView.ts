/**
 * The view uniform of deferred resolve and composition (`VIEW_WGSL`): the inverse
 * view-projection, the camera, the viewport — size, raw-output flag, rank of a sampled image —,
 * the background and the contract's light parameters. One buffer, one packed array, written
 * once per image; the shader-side layout is the struct in `deferredLightingShaders.ts`.
 */
import { clearValueOf } from '../sdk-core/src/world/math/packedColour.ts';
import { TONE_MAPPING_RANK } from '../sdk-core/src/scene/core/environment.ts';

const DEFERRED_VIEW_BYTES = 144;

/** With no declared light: zero lights, zero tiles, exposure 1, the ACES curve. */
export const ZERO_DIRECT = [0, 0, 0, 1, TONE_MAPPING_RANK.aces, 0, 0, 0] as const;

export function createDeferredView(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'WG deferred view v1',
    size: DEFERRED_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(DEFERRED_VIEW_BYTES / 4);
  return {
    buffer,
    /** `rawOutput` skips the display chain; `sampledRank` non-zero draws a subset of each
     *  pixel's lights (`directLightSamplingWgsl.ts`); `direct` carries the contract lights, the
     *  tiles in X and Y, the exposure, then the display curve's rank. */
    write(
      inverseViewProjection: ArrayLike<number>,
      camera: readonly number[],
      width: number,
      height: number,
      clearColor: number,
      rawOutput: boolean,
      direct: ArrayLike<number>,
      sampledRank: number,
    ) {
      packed.set(inverseViewProjection as ArrayLike<number> & number[], 0);
      packed.set(camera, 16);
      packed.set([width, height, rawOutput ? 1 : 0, sampledRank], 20);
      const clear = clearValueOf(clearColor);
      packed.set([clear.r, clear.g, clear.b, clear.a], 24);
      packed.set(direct as number[], 28);
      device.queue.writeBuffer(buffer, 0, packed);
    },
    dispose() {
      buffer.destroy();
    },
  };
}
