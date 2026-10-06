/** Independent integration of GGX's sampled positive N.L weight, in its uniform variate. */
export function ggxIntegral(k: number, end: number, degree = 1) {
  const weight = (u: number) => Math.max(0, (1 - (k + 1) * u) / (1 + (k - 1) * u)) ** degree
  const simpson = (a: number, b: number) =>
    ((b - a) * (weight(a) + 4 * weight((a + b) / 2) + weight(b))) / 6
  const refine = (a: number, b: number, whole: number, depth: number): number => {
    const mid = (a + b) / 2,
      left = simpson(a, mid),
      right = simpson(mid, b)
    if (!depth || Math.abs(left + right - whole) < 1e-10) return left + right
    return refine(a, mid, left, depth - 1) + refine(mid, b, right, depth - 1)
  }
  return refine(0, end, simpson(0, end), 24)
}
