// A rectangle light's form factor is the exact integral of the clamped cosine over the part of
// the rectangle above the horizon, in f32, near, cut by the horizon, far away and far from the
// world's origin. The shipped `rectView`, `polygonFormFactor` and `ltcCorner` run in f32
// (`../shaderRunF32.fixture.ts`) against the clipped polygon's integral in f64 (each edge cut at the
// horizon, then the edges' sum of angles), itself checked against a Monte Carlo integral over the rectangle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LTC_SIZE, ltcTable } from '../../../../sdk-core/src/lighting/ltcTable.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { RECT_SHADING_WGSL } from './rectLightWgsl.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

type V = number[]
type View = { a: V; b: V; c: V; d: V; window: number }
const shader = shaderRun<{
  rectView: (light: object, P: V) => View
  polygonFormFactor: (a: V, b: V, c: V, d: V, up: V) => V
  ltcCorner: (q: V, T1: V, T2: V, N: V, m: V) => V
}>(
  wgslModule(RECT_SHADING_WGSL),
  ['rectView', 'polygonFormFactor', 'rectEdge', 'cutEdge', 'ltcCorner', 'faceNormal'],
  {
    ...F32_SCOPE,
    rangeWindow: () => 1,
    RectView: (a: V, b: V, c: V, d: V, window: number) => ({ a, b, c, d, window }),
    Outline: (F: V, exit: V, entry: V) => ({ F, exit, entry }),
  },
)

const f = Math.fround
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V, b: V) =>
  [0, 1, 2].map((i) => a[(i + 1) % 3] * b[(i + 2) % 3] - a[(i + 2) % 3] * b[(i + 1) % 3])
const unit = (a: V) => a.map((x) => x / Math.hypot(...a))

/** The form factor of the polygon (corners relative to the point) about `up`, in f64. */
function clipped(polygon: V[], up: V) {
  const kept: V[] = []
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length],
      [ha, hb] = [dot(a, up), dot(b, up)]
    if (ha > 0) kept.push(a)
    if (ha > 0 !== hb > 0) kept.push(a.map((x, k) => x + (ha / (ha - hb)) * (b[k] - x)))
  })
  let sum = 0
  kept.forEach((a, i) => {
    const c = cross(a, kept[(i + 1) % kept.length]),
      s = Math.hypot(...c)
    if (s > 0) sum += (dot(c, up) / s) * Math.atan2(s, dot(a, kept[(i + 1) % kept.length]))
  })
  return Math.abs(sum) / TAU
}

const random = lcgRandom(831)
const sphere = () => {
  const [z, t] = [2 * random() - 1, TAU * random()]
  return [Math.sqrt(1 - z * z) * Math.cos(t), Math.sqrt(1 - z * z) * Math.sin(t), z]
}

/** A light as the scene declares it (f32), `distance` from a point P near `origin`, P in front
 *  of its face; its true corners relative to P, in f64. */
function light(distance: number, size: number, origin = 0) {
  const P = sphere().map((x) => f(origin + 3 * x))
  const n = unit(sphere()).map(f)
  const toP = unit(sphere().map((x, k) => x + 1.2 * n[k]))
  const C = P.map((x, k) => f(x - (dot(toP, n) > 0.05 ? toP : n)[k] * distance))
  const U = unit(cross(n, sphere())).map((x) => f(x * size * (0.3 + random())))
  const h = f(size * (0.3 + random()))
  const W = F32_SCOPE.normalize(F32_SCOPE.cross(U, n)).map((x) => f(x * h))
  const record = { positionRange: [...C, 1e30], directionCone: [...n, 0], shape: [...U, h] }
  const corners = [-1, 1, 1, -1].map((u, i) =>
    [0, 1, 2].map((k) => C[k] - P[k] + u * U[k] + (i < 2 ? -1 : 1) * W[k]),
  )
  const view = shader.rectView(record, P)
  return {
    corners,
    quad: [view.a, view.b, view.c, view.d] as [V, V, V, V],
    toward: unit(corners[0].map((x, k) => x + corners[2][k])),
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
    const area = Math.hypot(...cross(e, g)),
      normal = unit(cross(e, g))
    let sum = 0
    const samples = 200000
    // A point o + u e + v g of the rectangle: its height over the horizon, its depth along the
    // rectangle's normal and its squared distance, each a polynomial in (u, v).
    const [h, z] = [up, normal].map((n) => [dot(o, n), dot(e, n), dot(g, n)])
    const [oo, oe, og, ee, eg, gg] = [
      dot(o, o),
      dot(o, e),
      dot(o, g),
      dot(e, e),
      dot(e, g),
      dot(g, g),
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
    const up = unit(sphere()).map(f)
    cut += Number(corners.some((q) => dot(q, up) > 0) && corners.some((q) => dot(q, up) <= 0))
    const exact = clipped(corners, up)
    if (corners.every((q) => dot(q, up) <= 0))
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
      return Math.abs(shader.polygonFormFactor(...quad, toward.map(f))[3] - exact) / exact
    })
    assert.ok(worst(errors) < bound, `${distance} m: ${worst(errors)}`)
  }
})

test('a far light in the mirror direction keeps its glint: the fitted lobe, clipped in its frame', () => {
  const table = ltcTable()
  const errors = Array.from({ length: 400 }, () => {
    const { corners, quad, toward } = light(500 * (0.5 + random()), 0.5)
    const V = sphere(),
      N = unit(toward.map((x, k) => x + V[k])).map(f)
    const T1 = unit(V.map((x, k) => x - N[k] * dot(N, V))).map(f),
      T2 = F32_SCOPE.cross(N, T1)
    const cell = [0.0525 + 0.5 * random(), Math.sqrt(1 - Math.max(dot(N, V), 1e-4))]
      .map((x) => Math.min(Math.round(x * (LTC_SIZE - 1)), LTC_SIZE - 1))
      .reduce((x, y) => y * LTC_SIZE + x)
    const m = Array.from(table.subarray(cell * 8, cell * 8 + 4))
    const moved = (q: V) => {
      const [x, z] = [dot(q, T1), dot(q, N)]
      return [m[0] * x + m[1] * z, dot(q, T2), m[2] * x + m[3] * z]
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
