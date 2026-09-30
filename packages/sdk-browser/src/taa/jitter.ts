/**
 * Temporal-antialiasing jitter: where each frame samples its pixels, and the render
 * matrix that applies it.
 *
 * The reference shifts its projection by a fraction of a pixel each frame, on a Halton
 * sequence in bases 2 and 3; eight frames cover the pixel evenly, and temporal accumulation
 * turns that into supersampling. The shift is a translation in clip space: it only reaches
 * the matrix the raster, shading and blend read, never the engine camera — selection,
 * its planes and its screen-error threshold see none of this jitter.
 */
import { halton } from './halton.ts';

/** Cycle length: eight Halton (2,3) positions, those of the reference. */
export const TAA_SAMPLES = 8;

/**
 * Jitter phases of a frame drawn `render` pixels wide and shown `display` wide (FSR 2's phase
 * count, `8 · (display / render)²`): eight at native size, 32 at half, so every display pixel
 * receives samples of its own. A still frame is held after at most 16 of them (`taaStillFrames`).
 */
export const upscalePhases = (render: number, display: number) =>
  Math.floor(TAA_SAMPLES * (display / render) ** 2);

/** The most still frames a held frame averages, at any render scale: the reference upscaler's
 *  (TSR's) history keeps about 16 samples a display pixel, whatever its jitter phases. */
const TAA_STILL_CAP = 2 * TAA_SAMPLES;

/**
 * Still frames accumulated before a frame can be held, at `phases` jitter phases: two cycles, or
 * one when two pass `TAA_STILL_CAP`, or the cycle's first `TAA_STILL_CAP` phases when one does —
 * a frame drawn at half the display (32 phases) rests after 16 frames, not 64 (#1346, a declared
 * class 2 below native size). On the first still frame history restarts at phase zero and the k-th
 * weighs 1/k, so the held frame is the UNIFORM AVERAGE of those frames, which depend only on the
 * final state — the same to the bit from one run to the next, which exponential accumulation does
 * not give: it would keep 12% of what the image was while pages and textures arrived, in an order
 * that is never twice the same. The cost, declared: on stop, edges stiffen for a frame or two
 * before reconverging — where the reference renders without end.
 */
export const taaStillFrames = (phases: number) =>
  phases <= TAA_SAMPLES ? 2 * phases : Math.min(phases, TAA_STILL_CAP);

/**
 * Texture level offset of a frame drawn at `render` pixels per display row of `display`: the
 * material pass's footprint is a render pixel, `log2(render / display)` brings it back to a display
 * pixel, so a texture keeps its native texel density. Zero at native size. FSR 2's extra −1 is not
 * taken: the truth is the native image, and one level finer would show more than it and shimmer.
 */
export const upscaleMipBias = (render: number, display: number) => Math.log2(render / display);

/**
 * Pixel offset for cycle sample `sample` among `phases`, in the pixels the frame is drawn in and
 * centred: each component is in (−0.5, 0.5). Writes `out[0]` and `out[1]`.
 */
export function taaJitter(sample: number, out: Float64Array, phases = TAA_SAMPLES) {
  const index = (sample % phases) + 1;
  out[0] = halton(index, 2) - 0.5;
  out[1] = halton(index, 3) - 0.5;
  return out;
}

/**
 * `out` = the view-projection shifted by `(jx, jy)` pixels: a translation added in clip space
 * — `x += 2·jx/width · w`, `y += 2·jy/height · w` —, so the first and second rows of the
 * column-major matrix receive the fourth multiplied by the offset. Zero jitter returns the
 * matrix identical, bit for bit.
 */
export function jitterViewProjection(
  out: Float64Array,
  viewProjection: ArrayLike<number>,
  jx: number,
  jy: number,
  width: number,
  height: number,
) {
  const dx = (2 * jx) / width,
    dy = (2 * jy) / height;
  for (let column = 0; column < 4; column++) {
    const at = column * 4,
      w = viewProjection[at + 3];
    out[at] = viewProjection[at] + dx * w;
    out[at + 1] = viewProjection[at + 1] + dy * w;
    out[at + 2] = viewProjection[at + 2];
    out[at + 3] = w;
  }
  return out;
}
