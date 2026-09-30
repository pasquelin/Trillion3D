/**
 * The view uniform of deferred resolve and composition (`VIEW_WGSL`): the inverse
 * view-projection, the camera, the viewport — size, raw-output flag, rank of a sampled image —,
 * the background, the contract's light parameters and the TAA jitter. One buffer, one packed array, written
 * once per image; the shader-side layout is the struct in `shaders.ts`.
 */
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts';
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts';

const DEFERRED_VIEW_BYTES = 160;

/**
 * The view's `jitter` words (`VIEW_WGSL`) of an image the TAA jitters by `jitter` pixels
 * (`taaJitter`), or of one it does not (`null`): where the jitter moved the image, in pixels, rows
 * down — what `pixelLevel` takes back out —, then the cosine and sine of the angle the shadow
 * filters' taps turn by (`shadowRotated`). The angle is the jitter's own Halton phase, `2π (jx + ½)`:
 * each phase of the cycle turns them apart, and the history the TAA keeps averages them (#1363).
 */
export function shadowJitterWords(jitter: ArrayLike<number> | null) {
  if (!jitter) return [0, 0, 1, 0];
  const angle = 2 * Math.PI * (jitter[0] + 0.5);
  return [jitter[0], -jitter[1], Math.cos(angle), Math.sin(angle)];
}

/** With no declared light: zero lights, zero tiles, exposure 1, the ACES curve, the eye unread. */
export const ZERO_DIRECT = [0, 0, 0, 1, TONE_MAPPING_RANK.aces, 0, 0, 0] as const;

export function createDeferredView(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'Trillion3D deferred view v1',
    size: DEFERRED_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const packed = new Float32Array(DEFERRED_VIEW_BYTES / 4);
  packed.set(shadowJitterWords(null), 36);
  return {
    buffer,
    /** The TAA jitter of the next image `write` writes (`shadowJitterWords`). */
    setJitter(jitter: ArrayLike<number> | null) {
      packed.set(shadowJitterWords(jitter), 36);
    },
    /** `rawOutput` skips the display chain; `sampledRank` non-zero draws a subset of each
     *  pixel's lights (`../direct/lightSamplingWgsl.ts`); `direct` carries the contract lights, the
     *  tiles in X and Y, the exposure, then the display curve's rank and the eye. */
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
