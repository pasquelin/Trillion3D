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

/** Cycle length: eight Halton (2,3) positions, those of the reference. */
export const TAA_SAMPLES = 8;

/**
 * Still frames accumulated before a frame can be held: two cycles. On the first still
 * frame history restarts at phase zero and the k-th weighs 1/k, so the held frame is the
 * UNIFORM AVERAGE of sixteen frames that depend only on the final state — the same to the bit
 * from one run to the next, which exponential accumulation does not give: it would keep
 * 12% of what the image was while pages and textures arrived, in an order that is never
 * twice the same. The cost, declared: on stop, edges stiffen for a frame or two before
 * reconverging — where the reference renders without end.
 */
export const TAA_STILL_FRAMES = 2 * TAA_SAMPLES;

/** The `index`-th term (from 1) of the van der Corput sequence in base `base`, in [0, 1). */
export function halton(index: number, base: number) {
  let result = 0,
    fraction = 1 / base,
    i = index;
  while (i > 0) {
    result += fraction * (i % base);
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
}

/**
 * Pixel offset for cycle sample `sample`, in pixels and centred: each component
 * is in (−0.5, 0.5). Writes `out[0]` and `out[1]`.
 */
export function taaJitter(sample: number, out: Float64Array) {
  const index = (sample % TAA_SAMPLES) + 1;
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
