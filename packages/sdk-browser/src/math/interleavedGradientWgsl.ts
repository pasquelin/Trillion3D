/** Interleaved gradient noise at screen point p (a WGSL vec2f expression), in [0, 1): a fractional
 *  part of a linear function of the pixel, which spreads its values evenly over neighbouring
 *  pixels. One expression every program inlines where it dithers — a shadow's penumbra, its rays' rotation, a
 *  blended mirror's march — never a function two modules of one program would both declare.
 *
 *  The three numbers, declared: they stand for the pattern's steps, not for a quantity of the
 *  scene. One pixel along x moves the value by 52.9829189 × 0.06711056 = 3.5557, 0.556 once
 *  wrapped, one along y by 0.309, and the inner wrap, every 14.9 pixels along x and 171 along y,
 *  adds 53 − 52.9829189 = 0.017. With those steps the nine values of any 3 × 3 block of pixels
 *  leave no gap wider than 0.14 of [0, 1) on a 4096 × 2304 screen in f32, where an even spread
 *  leaves 1/9 = 0.11 and nine independent draws 0.31 on average. Sensitivity: every dithered
 *  pixel reads them, so another digit moves the pixels of every penumbra, ray rotation and mirror
 *  march: an image change, never a refactor. */
export const interleavedGradientWgsl = (p: string) =>
  `fract(52.9829189*fract(dot(${p},vec2f(0.06711056,0.00583715))))`;
