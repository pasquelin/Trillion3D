/**
 * The view's `jitter` words (`VIEW_WGSL`) of an image the TAA jitters by `jitter` pixels
 * (`taaJitter`), or of one it does not (`null`): where the jitter moved the image, in pixels, rows
 * down — what `pixelLevel` takes back out —, then two zero words. No shadow filter turns with the
 * phase (#1363): its taps are the same every image, as the reference engine's filtered (PCF) lookups. Written `into`
 * at word `at`: the view's own words, a frame allocates nothing.
 */
export function shadowJitterWords<T extends { [word: number]: number } = number[]>(
  jitter: ArrayLike<number> | null,
  into: T = [0, 0, 0, 0] as unknown as T,
  at = 0,
): T {
  into[at] = jitter ? jitter[0] : 0;
  into[at + 1] = jitter ? -jitter[1] : 0;
  into[at + 2] = 0;
  into[at + 3] = 0;
  return into;
}
