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
