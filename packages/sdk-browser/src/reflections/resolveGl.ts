import { LTC_UNIT } from '../webgl/cluster/rectGlsl.ts';

/** Texture units of the reduced-resolution mirror resolve: its colour, then the depth it tests.
 *  They alias the frozen source's (`captureGl.target`), which the display pass no longer reads
 *  once the reduced image is bound there — no extra fragment texture unit, the program's budget
 *  full (#1292). */
export const REFLECTION_RESOLVE_UNITS: [number, number] = [LTC_UNIT + 1, LTC_UNIT + 2];

/**
 * A mirror receiver's screen-space trace is resolved at most at this many pixels, whatever the
 * display: the reflection's own budget, derived from the screen unit rather than a scene, so a 4K
 * frame pays the same trace as a smaller one. The trace is `O(pixels·(width + height))`; at a fixed
 * pixel budget its cost stops following the display. A mirror receiver whose image already fits the
 * budget keeps the image's own size, one trace a pixel, as before this pass.
 */
const REFLECTION_RESOLVE_PIXELS = 1 << 16;

/** The pixel size the mirror resolve traces at for a `width` x `height` image: the image itself
 *  when it already fits the budget, the aspect-preserving largest size within it otherwise. */
export function reflectionResolveExtent(width: number, height: number): [number, number] {
  const w = Math.max(1, Math.round(width)),
    h = Math.max(1, Math.round(height));
  if (w * h <= REFLECTION_RESOLVE_PIXELS) return [w, h];
  const divisor = Math.sqrt((w * h) / REFLECTION_RESOLVE_PIXELS);
  return [Math.max(1, Math.floor(w / divisor)), Math.max(1, Math.floor(h / divisor))];
}
