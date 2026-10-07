// The planet of `scattered-on-a-surface.html` makes its directions unit and reads its lengths
// through the engine's `math.vector3` (the length rule, docs/MATHS.md "Lengths"), where it divided
// by `Math.hypot`. Its directions feed one another — six splits of a twenty-sided ball, the relief
// read on each, the bands cut at their contour lines, ten thousand candidates and their slopes —,
// so the proof runs the page's generation through both and compares what reaches the engine and
// the rules: the bands' float32 positions and normals, the candidates' float32 placements, and
// every candidate's verdict at every sea level and steepness the controls offer.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { math } from '../../packages/sdk-core/src/world/math/index.ts'
import { seeded, valueNoise } from './kit/random.ts'

type Lengths = { unit: (v: number[]) => number[]; length: (v: number[]) => number }
const direction = math.vector3()
const OLD: Lengths = {
    unit: (v) => {
      const length = Math.hypot(...v)
      return v.map((value) => value / length)
    },
    length: (v) => Math.hypot(...v),
  },
  NEW: Lengths = {
    unit: (v) => direction.fromArray(v).normalize().toArray(),
    length: (v) => direction.fromArray(v).length(),
  }

const RADIUS = 3,
  LEVELS = [-Infinity, RADIUS + 0.03, RADIUS + 0.18, RADIUS + 0.34, Infinity]
const t = (1 + Math.sqrt(5)) / 2
// The page's twenty-sided ball, its corners and faces as it writes them.
// prettier-ignore
const ICOSAHEDRON = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1]
// prettier-ignore
const TWENTY = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
const cross = (u: number[], v: number[]) => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
]

/** The page's planet, its unit directions and lengths taken by `L`. */
function planet(L: Lengths) {
  const noise = valueNoise({ math })
  const elevation = (x: number, y: number, z: number) => {
    let sum = 0,
      amplitude = 0.6,
      scale = 1.4
    for (let octave = 0; octave < 5; octave++, amplitude *= 0.5, scale *= 2.1)
      sum += amplitude * noise(x * scale + 11, y * scale, z * scale - 7)
    return sum
  }
  const radiusAt = (x: number, y: number, z: number) => {
    const e = elevation(x, y, z)
    return RADIUS * (1 + (e < 0 ? 0.06 * e : 0.14 * e + 0.2 * e * e))
  }
  const corners = Array.from({ length: 12 }, (_, k) => L.unit(ICOSAHEDRON.slice(k * 3, k * 3 + 3)))
  let faces = TWENTY
  for (let split = 0; split < 6; split++) {
    const middles = new Map<number, number>(),
      next: number[] = []
    const middle = (a: number, b: number) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a
      if (!middles.has(key))
        middles.set(
          key,
          corners.push(L.unit(corners[a].map((v, axis) => v + corners[b][axis]))) - 1,
        )
      return middles.get(key)!
    }
    for (let f = 0; f < faces.length; f += 3) {
      const [a, b, c] = [faces[f], faces[f + 1], faces[f + 2]]
      const ab = middle(a, b),
        bc = middle(b, c),
        ca = middle(c, a)
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca)
    }
    faces = next
  }
  const surface = corners.map(([x, y, z]) => {
    const r = radiusAt(x, y, z)
    return [x * r, y * r, z * r]
  })
  const normals = surface.map(() => [0, 0, 0])
  for (let f = 0; f < faces.length; f += 3) {
    const [a, b, c] = [faces[f], faces[f + 1], faces[f + 2]].map((k) => surface[k])
    const n = cross(
      b.map((v, axis) => v - a[axis]),
      c.map((v, axis) => v - a[axis]),
    )
    for (let k = 0; k < 3; k++)
      normals[faces[f + k]].forEach((_, axis, sum) => (sum[axis] += n[axis]))
  }
  const vertex = (k: number) => [...surface[k], ...L.unit(normals[k]), L.length(surface[k])]
  const crossing = (p: number[], q: number[], level: number) => {
    const share = (level - p[6]) / (q[6] - p[6])
    return p.map((value, axis) => value + (q[axis] - value) * share)
  }
  const clip = (polygon: number[][], level: number, keepAbove: boolean) => {
    const kept: number[][] = [],
      inside = (p: number[]) => (keepAbove ? p[6] >= level : p[6] <= level)
    polygon.forEach((p, index) => {
      const q = polygon[(index + 1) % polygon.length]
      if (inside(p)) kept.push(p)
      if (inside(p) !== inside(q)) kept.push(crossing(p, q, level))
    })
    return kept
  }
  const bands = LEVELS.slice(1).map(() => [] as number[])
  for (let f = 0; f < faces.length; f += 3) {
    const triangle = [vertex(faces[f]), vertex(faces[f + 1]), vertex(faces[f + 2])]
    bands.forEach((band, index) => {
      let polygon = triangle
      if (index > 0) polygon = clip(polygon, LEVELS[index], true)
      if (index < bands.length - 1 && polygon.length)
        polygon = clip(polygon, LEVELS[index + 1], false)
      for (let k = 1; k + 1 < polygon.length; k++)
        for (const p of [polygon[0], polygon[k], polygon[k + 1]]) band.push(...p.slice(0, 6))
    })
  }
  const next = seeded(3),
    step = 0.004
  const candidates = Array.from({ length: 10000 }, () => {
    const y = next() * 2 - 1,
      around = next() * Math.PI * 2,
      ring = Math.sqrt(1 - y * y)
    const d = [ring * Math.cos(around), y, ring * Math.sin(around)]
    const a = L.unit(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])),
      b = cross(d, a)
    const point = (s: number, t: number) => {
      const q = L.unit(d.map((value, axis) => value + a[axis] * s + b[axis] * t)),
        r = radiusAt(q[0], q[1], q[2])
      return q.map((value) => value * r)
    }
    const here = point(0, 0),
      pa = point(step, 0),
      pb = point(0, step)
    const n = cross(
      pa.map((v, axis) => v - here[axis]),
      pb.map((v, axis) => v - here[axis]),
    )
    const cos = Math.abs(n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / L.length(n)
    return {
      d,
      r: L.length(here),
      slope: (Math.acos(cos) * 180) / Math.PI,
      size: 0.7 + next() * 0.7,
    }
  })
  return { bands: bands.map((band) => new Float32Array(band)), candidates }
}

test('the planet reaches the engine and its rules alike through the length rule and Math.hypot', () => {
  const old = planet(OLD),
    now = planet(NEW)
  old.bands.forEach((band, index) => {
    assert.equal(now.bands[index].length, band.length, `band ${index}`)
    band.forEach((value, k) =>
      assert.ok(Object.is(now.bands[index][k], value), `band ${index} word ${k}`),
    )
  })
  const f = Math.fround
  old.candidates.forEach(({ d, r, slope }, k) => {
    const spot = now.candidates[k]
    d.forEach((value) => {
      assert.equal(f(value * (spot.r - 0.01)), f(value * (r - 0.01)), `tree ${k}`)
      assert.equal(f(value * spot.r), f(value * r), `rock ${k}`)
    })
    // The controls: sea level −0.2 to 0.3 by 0.005, steepness 2 to 60 by 1.
    for (let s = -40; s <= 60; s++)
      assert.equal(spot.r > RADIUS + s * 0.005 + 0.02, r > RADIUS + s * 0.005 + 0.02)
    assert.equal(spot.r < LEVELS[3], r < LEVELS[3], `snow ${k}`)
    for (let steepest = 2; steepest <= 60; steepest++) {
      assert.equal(spot.slope <= steepest, slope <= steepest, `tree slope ${k}`)
      assert.equal(spot.slope > steepest * 0.6, slope > steepest * 0.6, `rock slope ${k}`)
    }
  })
})
