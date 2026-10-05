/**
 * The `index`-th term (from 1) of the van der Corput sequence in base `base`, in [0, 1): the
 * Halton sequence one base at a time. Base 2 is the radical inverse — the bits of `index` mirrored
 * about the point, each digit's weight an exact power of two; bases 2 and 3 are the jitter of
 * temporal antialiasing.
 */
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
