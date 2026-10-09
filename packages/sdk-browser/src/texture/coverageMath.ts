/**
 * The integer arithmetic of the coverage-preserving alpha (docs/FORMAT.md, "Coverage-preserving
 * alpha", #44), written once: the compiler's chains (`texture_preview/coverage_math.rs`) and the
 * card's (`coverageMathWgsl.ts`) run these lines, printed from here
 * (`scripts/generate-shared-rules.ts`), so every builder lands on the same byte. Every value is
 * an unsigned 32-bit integer; a quotient truncates.
 */

/** The corner alphas of a texel's square: itself, its right, lower and diagonal neighbours. */
type Quad = readonly [number, number, number, number]

/** Step 4: alpha `a` scaled to cutoff `c` at `t`, `a × (C − 0.5) / (t − 0.5)` rounded half up. */
export function scaled(a: number, c: number, t: number) {
  return Math.min(255, Math.trunc((2 * a * (2 * c - 1) + 2 * t - 1) / (4 * t - 2)))
}

/** Bilinear sample `s` (0 to 3, row by row) of the square of corner alphas `a`, rounded half up:
 *  9, 3, 3, 1 sixteenths from the nearest. */
export function filtered(a: Quad, s: number) {
  const x = 3 - 2 * (s & 1),
    y = 3 - 2 * (s >> 1)
  return (y * (x * a[0] + (4 - x) * a[1]) + (4 - y) * (x * a[2] + (4 - x) * a[3]) + 8) >> 4
}

/** Step 2's bin of sample `s` of square `a`: the highest `t` whose scale lifts it to `c` or more,
 *  searched between the square's lowest and highest corners — a corner reaches `c` exactly while
 *  `t` is at most its byte, and a sample lies between its corners, so the bin does too. */
export function cutBin(a: Quad, s: number, c: number) {
  let low = Math.min(Math.min(a[0], a[1]), Math.min(a[2], a[3])),
    high = Math.max(Math.max(a[0], a[1]), Math.max(a[2], a[3])) + 1
  while (high - low > 1) {
    const t = (low + high) >> 1
    if (
      filtered(
        [scaled(a[0], c, t), scaled(a[1], c, t), scaled(a[2], c, t), scaled(a[3], c, t)],
        s,
      ) >= c
    )
      low = t
    else high = t
  }
  return low
}
