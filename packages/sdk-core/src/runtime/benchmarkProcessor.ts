/**
 * The hardware benchmark's two processor tests (`hardwareBenchmark.ts`, `CPU_METHODS`), run by the
 * benchmark's worker (`sdk-browser/src/session/world/benchmarkWorker.ts`): segments against a
 * triangle in double precision, and a Julia set in single precision.
 */

const f = Math.fround

/** The reference's random stream from `seed`: a linear congruence, each draw a fraction in [0, 1)
 *  from the top 23 bits. */
function randomStream(seed: number) {
  return () => {
    seed = (Math.imul(seed, 196314165) + 907633515) >>> 0
    return (seed >>> 9) / 8388608
  }
}

/** A random direction, uniform, from `fraction`: a point of the cube kept inside the ball, then
 *  normalized, written into `out`. */
function unitVector(fraction: () => number, out: number[]) {
  for (;;) {
    const x = fraction() * 2 - 1,
      y = fraction() * 2 - 1,
      z = fraction() * 2 - 1
    const l = x * x + y * y + z * z
    if (l > 1 || l < f(1e-4)) continue
    const s = 1 / Math.sqrt(l)
    out[0] = x * s
    out[1] = y * s
    out[2] = z * s
    return
  }
}

const V1 = [f(0.1), f(0.2), f(2.3)]
const EDGE1 = [f(-2.1) - V1[0], f(0.2) - V1[1], f(0.3) - V1[2]]
const EDGE2 = [f(2.1) - V1[0], f(0.2) - V1[1], f(0.3) - V1[2]]

/** Whether the segment from `s` along `d` crosses the triangle (the minimum-storage test). */
function crossesTriangle(s: number[], d: number[]) {
  const [e1x, e1y, e1z] = EDGE1,
    [e2x, e2y, e2z] = EDGE2
  const px = d[1] * e2z - d[2] * e2y,
    py = d[2] * e2x - d[0] * e2z,
    pz = d[0] * e2y - d[1] * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (det < 0.00001) return false
  const tx = s[0] - V1[0],
    ty = s[1] - V1[1],
    tz = s[2] - V1[2]
  const u = tx * px + ty * py + tz * pz
  if (u < 0 || u > det) return false
  const qx = ty * e1z - tz * e1y,
    qy = tz * e1x - tx * e1z,
    qz = tx * e1y - ty * e1x
  const v = d[0] * qx + d[1] * qy + d[2] * qz
  if (v < 0 || u + v > det) return false
  return (e2x * qx + e2y * qy + e2z * qz) / det >= 0
}

/** The ray–triangle test: 200 000 segments between two random points of the sphere of radius 3;
 *  the share that crosses the triangle. */
function rayTriangle() {
  const fraction = randomStream(0x1234)
  const steps = 200000
  const a = [0, 0, 0],
    b = [0, 0, 0],
    start = [0, 0, 0],
    along = [0, 0, 0]
  let hits = 0
  for (let i = 0; i < steps; i++) {
    unitVector(fraction, a)
    unitVector(fraction, b)
    for (let k = 0; k < 3; k++) {
      start[k] = a[k] * 3
      along[k] = b[k] * 3 - start[k]
    }
    if (crossesTriangle(start, along)) hits++
  }
  return hits / steps
}

/** Iterations of the Julia set at `c = (-0.73, 0.176)` from `(x, y)`, at most 300, until the square
 *  distance passes 1600, in single precision. */
function juliaIterations(x: number, y: number) {
  let iterations = 0,
    dist2 = 0
  while (dist2 <= 1600 && iterations < 300) {
    const x2 = f(f(f(x * x) - f(y * y)) + f(-0.73))
    const y2 = f(f(f(2 * x) * y) + f(0.176))
    x = x2
    y = y2
    iterations++
    dist2 = f(f(x * x) + f(y * y))
  }
  return iterations
}

/** The fractal: the Julia set over 256² points of [-1, 1)²; the mean iterations, and a random
 *  share that keeps the sum from being folded into a constant. */
function fractal() {
  const extent = 256
  let sum = 0
  for (let py = 0; py < extent; py++)
    for (let px = 0; px < extent; px++)
      sum = f(sum + juliaIterations(f(f(f(px / extent) * 2) - 1), f(f(f(py / extent) * 2) - 1)))
  return sum / (extent * extent) + Math.random()
}

/**
 * Runs processor test `method` (0 the ray–triangle test, 1 the fractal) `max(1, trunc(workScale))`
 * times, each run timed alone by `now` (milliseconds): the seconds in all and per run, and a sum of
 * what the runs found, which keeps them from being optimized away.
 */
export function runCpuMethod(method: number, workScale: number, now: () => number) {
  const test = method === 0 ? rayTriangle : fractal
  const runs = Math.max(1, Math.trunc(workScale))
  let total = 0,
    found = 0
  for (let i = 0; i < runs; i++) {
    const start = now()
    found += test()
    total += (now() - start) / 1000
  }
  return { total, normalized: total / runs, found }
}
