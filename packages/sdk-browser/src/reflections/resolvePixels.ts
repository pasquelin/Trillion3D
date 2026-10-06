/**
 * A mirror receiver's screen-space trace is resolved at most at this many pixels, whatever the
 * display: the reflection's own budget, derived from the screen unit rather than a scene, so a 4K
 * frame pays the same trace as a smaller one. The trace is `O(pixels·(width + height))`; at a fixed
 * pixel budget its cost stops following the display. A mirror receiver whose image already fits the
 * budget keeps the image's own size, one trace a pixel.
 */
export const REFLECTION_RESOLVE_PIXELS = 1 << 16
