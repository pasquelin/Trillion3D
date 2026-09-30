/**
 * The view's `jitter` words (`VIEW_WGSL`) of an image the TAA jitters by `jitter` pixels
 * (`taaJitter`), or of one it does not (`null`): where the jitter moved the image, in pixels, rows
 * down — what `pixelLevel` takes back out —, then the cosine and sine of the angle the shadow
 * filters' taps turn by (`shadowRotated`). The angle is the jitter's own Halton phase, `2π (jx + ½)`:
 * each phase of the cycle turns them apart, and the history the TAA keeps averages them (#1363).
 * Written `into` at word `at`: the view's own words, a frame allocates nothing.
 */
export function shadowJitterWords<T extends { [word: number]: number } = number[]>(
  jitter: ArrayLike<number> | null,
  into: T = [0, 0, 0, 0] as unknown as T,
  at = 0,
): T {
  const x = jitter ? jitter[0] : 0,
    angle = jitter ? 2 * Math.PI * (x + 0.5) : 0;
  into[at] = x;
  into[at + 1] = jitter ? -jitter[1] : 0;
  into[at + 2] = Math.cos(angle);
  into[at + 3] = Math.sin(angle);
  return into;
}
