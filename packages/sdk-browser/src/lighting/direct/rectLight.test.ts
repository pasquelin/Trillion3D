// A rectangle light's form factor is the exact integral of the clamped cosine over the part of
// the rectangle above the horizon, in f32, near, cut by the horizon, far away and far from the
// world's origin. The shipped `rectView`, `polygonFormFactor` and `ltcCorner` run in f32
// (`../shaderRunF32.fixture.ts`) against the clipped polygon's integral in f64 (each edge cut at the
// horizon, then the edges' sum of angles), itself checked against a Monte Carlo integral over the rectangle.
// Its integral with no normal (`rectFormOf`, what a medium reads of it) is the projected solid angle.
import { testLight } from './testLight.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { LTC_SIZE, ltcTable } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { RECT_SURFACE_LIGHT_WGSL } from './rectLightWgsl.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import { cross, unit } from '../../../../math/src/vector/vectorTuple.ts'
import { splitSumTerm } from '../../../../math/src/wgsl/lighting.ts'

type V = number[]
type V3 = [number, number, number]
type View = { a: V; b: V; c: V; d: V; window: number }
const shader = shaderRun<{
  rectView: (light: object, P: V) => View
  polygonFormFactor: (a: V, b: V, c: V, d: V, up: V) => V
  ltcCorner: (q: V, T1: V, T2: V, N: V, m: V) => V
  rectFormOf: (view: View) => number
  rectIrradianceOf: (view: View, N: V) => V
}>(
  wgslModule(RECT_SURFACE_LIGHT_WGSL),
  [
    'rectView',
    'polygonFormFactor',
    'rectEdge',
    'cutEdge',
    'ltcCorner',
    'faceNormal',
    'rectFormOf',
    'rectIrradianceOf',
  ],
  {
    ...F32_SCOPE,
    rangeWindow: () => 1,
  },
)

/** The form factor of the polygon (corners relative to the point) about `up`, in f64. */
function clipped(polygon: V[], up: V) {
  const kept: V[] = []
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length],
      [ha, hb] = [dotVector3(a, up), dotVector3(b, up)]
    if (ha > 0) kept.push(a)
    if (ha > 0 !== hb > 0) kept.push(a.map((x, k) => x + (ha / (ha - hb)) * (b[k] - x)))
  })
  let sum = 0
  kept.forEach((a, i) => {
    const c = cross(a as V3, kept[(i + 1) % kept.length] as V3),
      s = Math.hypot(...c)
    if (s > 0)
      sum += (dotVector3(c, up) / s) * Math.atan2(s, dotVector3(a, kept[(i + 1) % kept.length]))
  })
  return Math.abs(sum) / TAU
}

const random = lcgRandom(831)
const sphere = () => {
  const [z, t] = [2 * random() - 1, TAU * random()]
  return [Math.sqrt(1 - z * z) * Math.cos(t), Math.sqrt(1 - z * z) * Math.sin(t), z] as V3
}

/** A light as the scene declares it (f32), `distance` from a point P near `origin`, P in front
 *  of its face; its true corners relative to P, in f64. */
function light(distance: number, size: number, origin = 0) {
  const P = sphere().map((x) => Math.fround(origin + 3 * x))
  const n = unit(sphere()).map(Math.fround)
  const toP = unit(sphere().map((x, k) => x + 1.2 * n[k]) as V3)
  const C = P.map((x, k) => Math.fround(x - (dotVector3(toP, n) > 0.05 ? toP : n)[k] * distance))
  const U = unit(cross(n as V3, sphere())).map((x) => Math.fround(x * size * (0.3 + random())))
  const h = Math.fround(size * (0.3 + random()))
  const W = F32_SCOPE.normalize(F32_SCOPE.cross(U, n)).map((x) => Math.fround(x * h))
  const record = testLight({
    positionRange: [...C, 1e30],
    directionCone: [...n, 0],
    shape: [...U, h],
  })
  const corners = [-1, 1, 1, -1].map((u, i) =>
    [0, 1, 2].map((k) => C[k] - P[k] + u * U[k] + (i < 2 ? -1 : 1) * W[k]),
  )
  const view = shader.rectView(record, P)
  return {
    corners,
    quad: [view.a, view.b, view.c, view.d] as [V, V, V, V],
    toward: unit(corners[0].map((x, k) => x + corners[2][k]) as V3),
  }
}

const worst = (errors: number[]) => Math.max(...errors)

test('the f64 reference is the integral of the clamped cosine over the rectangle (Monte Carlo)', () => {
  for (let i = 0; i < 4; i++) {
    const { corners } = light(1, 0.8)
    const up = unit(sphere())
    const [o, e, g] = [
      corners[0],
      corners[1].map((x, k) => x - corners[0][k]),
      corners[3].map((x, k) => x - corners[0][k]),
    ]
    const area = Math.hypot(...cross(e as V3, g as V3)),
      normal = unit(cross(e as V3, g as V3))
    let sum = 0
    const samples = 200000
    // A point o + u e + v g of the rectangle: its height over the horizon, its depth along the
    // rectangle's normal and its squared distance, each a polynomial in (u, v).
    const [h, z] = [up, normal].map((n) => [dotVector3(o, n), dotVector3(e, n), dotVector3(g, n)])
    const [oo, oe, og, ee, eg, gg] = [
      dotVector3(o, o),
      dotVector3(o, e),
      dotVector3(o, g),
      dotVector3(e, e),
      dotVector3(e, g),
      dotVector3(g, g),
    ]
    for (let s = 0; s < samples; s++) {
      const [u, v] = [random(), random()]
      const r2 = oo + 2 * (u * oe + v * og + u * v * eg) + u * u * ee + v * v * gg
      sum +=
        (Math.max(h[0] + u * h[1] + v * h[2], 0) * Math.abs(z[0] + u * z[1] + v * z[2])) / (r2 * r2)
    }
    const estimate = (sum * area) / samples / Math.PI
    assert.ok(
      Math.abs(estimate - clipped(corners, up)) < 3e-3 * Math.max(estimate, 0.01),
      `${estimate}`,
    )
  }
})

test('a rectangle cut by the horizon is integrated to f32, whole above, cut or whole below', () => {
  const share: number[] = []
  let cut = 0
  for (let i = 0; i < 1500; i++) {
    const { corners, quad, toward } = light(0.2 + 4 * random(), 0.1 + random())
    const up = unit(sphere()).map(Math.fround)
    cut += Number(
      corners.some((q) => dotVector3(q, up) > 0) && corners.some((q) => dotVector3(q, up) <= 0),
    )
    const exact = clipped(corners, up)
    if (corners.every((q) => dotVector3(q, up) <= 0))
      assert.equal(shader.polygonFormFactor(...quad, up)[3], 0)
    // In units of the irradiance of a face turned to the light: the proxy sphere was 24 % off.
    else
      share.push(
        Math.abs(shader.polygonFormFactor(...quad, up)[3] - exact) / clipped(corners, toward),
      )
  }
  assert.ok(cut > 400, `${cut} cut`)
  assert.ok(worst(share) < 1e-4, `${worst(share)}`)
})

test('a light 1 000 times its size away, or 1e4 m from the origin, keeps its irradiance', () => {
  for (const [distance, origin, bound] of [
    [500, 0, 1e-3], // acos of unit corners: 59 % off
    [2, 1e4, 1e-5], // corners rounded at their world position: 0.8 % off
  ]) {
    const errors = Array.from({ length: 400 }, () => {
      const { corners, quad, toward } = light(distance * (0.5 + random()), 0.5, origin)
      const exact = clipped(corners, toward)
      return Math.abs(shader.polygonFormFactor(...quad, toward.map(Math.fround))[3] - exact) / exact
    })
    assert.ok(worst(errors) < bound, `${distance} m: ${worst(errors)}`)
  }
})

test('a far light in the mirror direction keeps its glint: the fitted lobe, clipped in its frame', () => {
  const table = ltcTable()
  const errors = Array.from({ length: 400 }, () => {
    const { corners, quad, toward } = light(500 * (0.5 + random()), 0.5)
    const V = sphere(),
      N = unit(toward.map((x, k) => x + V[k]) as V3).map(Math.fround)
    const T1 = unit(V.map((x, k) => x - N[k] * dotVector3(N, V)) as V3).map(Math.fround),
      T2 = F32_SCOPE.cross(N, T1)
    const cell = [0.0525 + 0.5 * random(), Math.sqrt(1 - Math.max(dotVector3(N, V), 1e-4))]
      .map((x) => Math.min(Math.round(x * (LTC_SIZE - 1)), LTC_SIZE - 1))
      .reduce((x, y) => y * LTC_SIZE + x)
    const m = Array.from(table.subarray(cell * 8, cell * 8 + 4))
    const moved = (q: V) => {
      const [x, z] = [dotVector3(q, T1), dotVector3(q, N)]
      return [m[0] * x + m[1] * z, dotVector3(q, T2), m[2] * x + m[3] * z]
    }
    const exact = clipped(corners.map(moved), [0, 0, 1])
    const lobe = shader.polygonFormFactor(
      ...(quad.map((q) => shader.ltcCorner(q, T1, T2, N, m)) as [V, V, V, V]),
      [0, 0, 1],
    )
    return Math.abs(lobe[3] - exact) / exact
  })
  // The proxy sphere and acos: 260 % off.
  assert.ok(worst(errors) < 1e-3, `${worst(errors)}`)
})

test('a rectangle’s integral with no normal is its projected solid angle, the area over the squared distance far away', () => {
  // A square of side `side` facing the point, `distance` away along its axis: the integral of the
  // cosine of the angle to the axis over its solid angle, `d² dA / r⁴` over the square, by midpoints.
  const projected = (side: number, distance: number) => {
    const n = 600
    let sum = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const [x, y] = [((i + 0.5) / n - 0.5) * side, ((j + 0.5) / n - 0.5) * side]
        sum += distance ** 2 / (x * x + y * y + distance ** 2) ** 2
      }
    return (sum * side * side) / (n * n)
  }
  const view = (side: number, distance: number): View => {
    const h = side / 2
    return {
      a: [-h, -h, distance],
      b: [h, -h, distance],
      c: [h, h, distance],
      d: [-h, h, distance],
      window: 1,
    }
  }
  for (const [side, distance] of [
    [1, 1],
    [2, 0.5],
    [0.1, 0.3],
    [1, 3],
  ])
    near1(
      shader.rectFormOf(view(side, distance)),
      projected(side, distance),
      2e-5,
      `${side}/${distance}`,
    )
  // Far away it is the area over the squared distance.
  near1(shader.rectFormOf(view(1, 500)), 1 / 500 ** 2, 1e-4, 'far')
})
test('a rectangle’s diffuse is its whole form factor under the cosine wrapped about the horizon of a sphere of its solid angle', () => {
  let wrapped = 0
  for (let i = 0; i < 300; i++) {
    const { corners, quad, toward } = light(0.3 + 3 * random(), 0.1 + random())
    // The whole polygon's vector form factor in f64, facing the polygon: its length half the
    // irradiance of a face turned to it, its direction the mean direction of the light.
    const sum = [0, 0, 0]
    corners.forEach((p, k) => {
      const [q, c] = [corners[(k + 1) % 4], cross(p as V3, corners[(k + 1) % 4] as V3)]
      const angle = Math.atan2(Math.hypot(...c), dotVector3(p, q)) / Math.hypot(...c)
      c.forEach((x, m) => (sum[m] += x * angle))
    })
    const side = dotVector3(sum, toward) < 0 ? -1 : 1
    const mean = unit(sum.map((x) => x * side) as V3)
    const irradiance = 0.5 * Math.hypot(...sum)
    const sinSq = irradiance / Math.PI
    const wrap = (cosine: number) => {
      const s = Math.sqrt(sinSq)
      return cosine < s ? (s + Math.max(cosine, -s)) ** 2 / (4 * s) : cosine
    }
    const view: View = { a: quad[0], b: quad[1], c: quad[2], d: quad[3], window: 1 }
    // Facing it, on the horizon through its centre, away from it, and any way.
    const level = unit(cross(mean, sphere()))
    for (const N of [mean, level, mean.map((x) => -x), sphere()] as V3[]) {
      const [x, y, z, e] = shader.rectIrradianceOf(view, N)
      const want = irradiance * Math.max(wrap(dotVector3(N, mean)), 0)
      assert.ok(Math.abs(e - want) <= 1e-4 * irradiance, `${e} against ${want}`)
      assert.ok(Math.hypot(x - mean[0], y - mean[1], z - mean[2]) < 1e-4, 'the mean direction')
      // Wound the other way, the same light.
      const back = shader.rectIrradianceOf(
        { ...view, a: quad[3], b: quad[2], c: quad[1], d: quad[0] },
        N,
      )
      assert.ok(
        back.every((v, k) => Math.abs(v - [x, y, z, e][k]) < 1e-5),
        'the other winding',
      )
      wrapped += Number(dotVector3(N, mean) < Math.sqrt(sinSq) && e > 0)
    }
  }
  assert.ok(wrapped > 100, `${wrapped} at the horizon's wrap`)
})
const near1 = (got: number, want: number, relative: number, label: string) =>
  assert.ok(Math.abs(got - want) <= relative * want, `${label}: ${got} against ${want}`)

test('a lobe on a specular under 2% keeps its Fresnel share dimmed with it, as the light’s own term', () => {
  const { splitSumTerm: term } = shaderRun<{ splitSumTerm: (f0: V, t: V) => V }>(
    wgslModule(splitSumTerm),
    ['splitSumTerm'],
    {},
  )
  const [magnitude, share] = [0.8, 0.3].map(Math.fround)
  for (const f0 of [0.01, 0.3]) {
    const f90 = Math.min(50 * f0, 1)
    const got = term([f0, f0, f0].map(Math.fround), [magnitude, share, 0, 0])
    for (const x of got) assert.ok(Math.abs(x - (f0 * magnitude + (f90 - f0) * share)) < 1e-6)
  }
})
