// What the family's floor must show (`runtimeFamilyCases.ts`): at each pixel of the grid the page read, the
// floor point its primary ray meets, the lobe of its reflection — the engine's GGX lobe at the floor's
// roughness, a deterministic many-sample reference over the exact geometry (`runtimeFamilyRays.ts`) —, weighed
// by the split-sum term of the floor's reflectance. A pixel is decided when it is floor alone and neither it
// nor its four neighbours have their mirror ray end on another shape: the pixels on the edge of a reflected
// shape are antialiased, which no ray answers whole.
import { TAU } from '../../../packages/math/src/constants.ts'
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
import { GRID, type FamilyCase, type Rgb } from './runtimeFamilyCases.ts'
import { crossings, cross, radiance, scale, sub, unit, add, type Vec } from './runtimeFamilyRays.ts'

/** The lobe's reference samples. */
const LOBE_SAMPLES = 96
/** The error the proof declares: relative to the expected value, plus an absolute floor. */
export const TOLERANCE = { relative: 0.25, absolute: 0.02 }
const FLOOR_REACH = 30

const reflect = (v: Vec, h: Vec): Vec =>
  sub(scale(h, 2 * (v[0] * h[0] + v[1] * h[1] + v[2] * h[2])), v)

/** The split-sum term `f0 · A + B` of the GGX lobe (a public analytic fit of it). */
function splitSum(f0: number, rough: number, nov: number) {
  const c0 = [-1, -0.0275, -0.572, 0.022],
    c1 = [1, 0.0425, 1.04, -0.04]
  const r = c0.map((v, k) => v * rough + c1[k])
  const a004 = Math.min(r[0] * r[0], 2 ** (-9.28 * nov)) * r[0] + r[1]
  return f0 * (-1.04 * a004 + r[2]) + 1.04 * a004 + r[3]
}

export type Decided = {
  index: number
  expected: Rgb
  at: [number, number]
  hit: number
  /** The floor point and the unit vector from it to the eye. */
  point: Vec
  view: Vec
}

/** The decided pixels of the grid of an image `width × height` and what each must show. */
export function expectedFloor(
  c: FamilyCase,
  width: number,
  height: number,
  lobeSamples = LOBE_SAMPLES,
): Decided[] {
  const forward = unit(sub(c.target, c.eye)),
    right = unit(cross(forward, [0, 1, 0])),
    up = cross(right, forward),
    slope = perspectiveSlope(c.fov),
    aspect = width / height
  const eye: Vec = c.eye
  const primary = (i: number, j: number) => {
    const x = ((i + 0.5) / width) * 2 - 1,
      y = 1 - ((j + 0.5) / height) * 2
    return unit(add(add(forward, scale(right, x * slope * aspect)), scale(up, y * slope)))
  }
  /** The floor point of the ray `d` from the eye, or null when a shape or the sky comes first. */
  const floorPoint = (d: Vec): Vec | null => {
    if (d[1] >= -1e-6) return null
    const t = -eye[1] / d[1],
      p: Vec = add(eye, scale(d, t))
    if (Math.abs(p[0]) > FLOOR_REACH || Math.abs(p[2]) > FLOOR_REACH) return null
    return c.shapes.some((s) => crossings(s, eye, d)[0] < t) ? null : p
  }
  const mirror = (d: Vec): Vec => [d[0], -d[1], d[2]]
  const rough = c.floor.roughness
  const out: Decided[] = []
  let index = 0
  for (let j = GRID >> 1; j < height; j += GRID)
    for (let i = GRID >> 1; i < width; i += GRID, index++) {
      const here = floorPoint(primary(i, j))
      if (!here) continue
      const first = (p: Vec, d: Vec) => radiance(c, p, mirror(d)).first
      const own = first(here, primary(i, j))
      let rim = false
      for (const [di, dj] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const d = primary(i + di, j + dj),
          p = floorPoint(d)
        if (!p || first(p, d) !== own) rim = true
      }
      if (rim) continue
      const d = primary(i, j),
        v: Vec = [-d[0], -d[1], -d[2]],
        nov = v[1]
      const alpha = Math.max(rough * rough, 1e-4)
      const total: Rgb = [0, 0, 0]
      const count = rough < 0.04 ? 1 : lobeSamples
      for (let k = 0; k < count; k++) {
        // The half vector of the lobe's D·cosθ, on a Hammersley set.
        const u = (k + 0.5) / count
        let bits = k,
          radical = 0,
          f = 0.5
        for (; bits; bits >>= 1, f /= 2) radical += (bits & 1) * f
        const cosT = count === 1 ? 1 : Math.sqrt((1 - u) / (1 + (alpha * alpha - 1) * u)),
          sinT = Math.sqrt(1 - cosT * cosT),
          phi = TAU * radical
        const l = reflect(v, [sinT * Math.cos(phi), cosT, sinT * Math.sin(phi)])
        if (l[1] <= 0) continue
        const { rgb } = radiance(c, here, l)
        for (let m = 0; m < 3; m++) total[m] += rgb[m] / count
      }
      const f0 = c.floor.metal ? 1 : 0.04,
        w = splitSum(f0, rough, nov)
      out.push({
        index,
        expected: total.map((e) => e * w) as Rgb,
        at: [i, j],
        hit: own,
        point: here,
        view: v,
      })
    }
  return out
}

/** The decided pixels `samples` (RGB, the grid order) meets, the share of them within the tolerance, and the
 *  worst one: the pixel off by the largest share of what it must show. */
export function judge(decided: Decided[], samples: number[]) {
  let passed = 0
  // The failing pixels by what is wrong: nothing shown where something is expected (`missing`), something
  // shown where nothing is (`spurious`), both nonzero but off (`energy`: `over` brighter, `under` darker).
  const kinds = { missing: 0, spurious: 0, over: 0, under: 0 }
  let worst = {
    index: -1,
    got: [0, 0, 0] as Rgb,
    expected: [0, 0, 0] as Rgb,
    off: 0,
    at: [0, 0],
    hit: -1,
  }
  for (const { index, expected, at, hit } of decided) {
    const got = [0, 1, 2].map((m) => samples[index * 3 + m]) as Rgb
    const off = Math.max(
      ...[0, 1, 2].map((m) => {
        const miss = Math.abs(got[m] - expected[m])
        return Math.max(0, miss - TOLERANCE.absolute) / Math.max(expected[m], TOLERANCE.absolute)
      }),
    )
    if (off <= TOLERANCE.relative) passed++
    else {
      const [g, e] = [Math.max(...got), Math.max(...expected)]
      if (e <= TOLERANCE.absolute) kinds.spurious++
      else if (g <= TOLERANCE.absolute) kinds.missing++
      else if (g > e) kinds.over++
      else kinds.under++
    }
    if (off > worst.off) worst = { index, got, expected, off, at, hit }
  }
  return {
    kinds,
    decided: decided.length,
    passed,
    rate: decided.length ? passed / decided.length : 1,
    worst,
  }
}
