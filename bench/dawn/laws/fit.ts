// The law a measured curve obeys: its exponent, the least-squares slope of log y on log x, and its
// straight line, y = a + b·x by least squares. Pure.

/** The least-squares line through the points (x, y): intercept `a`, slope `b`. */
export function linearFit(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length
  if (n < 2 || ys.length !== n) throw new Error('FIT: two points or more, as many y as x')
  const mx = xs.reduce((s, x) => s + x, 0) / n,
    my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0,
    sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
  }
  const b = sxx ? sxy / sxx : 0
  return { a: my - b * mx, b }
}

/** The exponent e of y ∝ x^e over the points with x and y both positive, `null` with fewer than
 *  two of them. */
export function exponentOf(xs: readonly number[], ys: readonly number[]) {
  const kept = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x > 0 && y > 0)
  if (kept.length < 2) return null
  return linearFit(
    kept.map(([x]) => Math.log(x)),
    kept.map(([, y]) => Math.log(y)),
  ).b
}

/** The law an exponent reads as, to a tenth: `O(1)` under 0.1, `O(x)` within 0.1 of one, else the
 *  power to a tenth. */
export function lawName(exponent: number | null, x = 'N') {
  if (exponent === null) return '—'
  if (Math.abs(exponent) < 0.1) return 'O(1)'
  if (Math.abs(exponent - 1) < 0.1) return `O(${x})`
  return `O(${x}^${exponent.toFixed(1)})`
}
