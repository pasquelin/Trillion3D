// The cloth's fuzz lobe (`sheenLobeWgsl.ts`): the shipped functions, run in f32 (`../shaderRunF32.fixture.ts`), against a twin in
// f64 of the lobe's definition — the cosine distribution of a direction moved by the table's transform, times the
// transform's Jacobian, times the lobe's albedo — and of the rectangle's integral, the polygon moved by the same transform
// and integrated with the exact edge angles. The table is read by a twin of the bilinear, edge-held sampler.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { fromHalf } from '../../../../math/src/float/half.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { cross, unit } from '../../../../math/src/vector/vectorTuple.ts'
import { dotVector3 as dot } from '../../../../math/src/vector/vector.ts'
import { sheenLtcHalves, SHEEN_LTC_SIZE } from '../../../../sdk-core/src/lighting/sheenLtc.ts'
import {
  CLOTH_SHEEN_WGSL,
  MIN_FUZZ_ROUGHNESS,
  SHEEN_LOBE_WGSL,
  SHEEN_RECT_WGSL,
  sheenFuzzRoughness,
} from './sheenLobeWgsl.ts'

type V3 = [number, number, number]
type View = { T1: V3; T2: V3; aInv: number; bInv: number; albedo: number }
type Quad = { a: V3; b: V3; c: V3; d: V3; window: number }

/** The table's texel (`row` the cosine, `column` the square root of the roughness), its first three channels. */
const texel = (row: number, column: number) => {
  const at =
    (Math.min(Math.max(row, 0), SHEEN_LTC_SIZE - 1) * SHEEN_LTC_SIZE +
      Math.min(Math.max(column, 0), SHEEN_LTC_SIZE - 1)) *
    4
  return [0, 1, 2].map((k) => fromHalf(sheenLtcHalves()[at + k]))
}
/** The table read as the bilinear sampler held to the edge reads it, at the transform of `sheenLtcCoefficients`. */
function table(NoV: number, roughness: number) {
  const size = SHEEN_LTC_SIZE
  const column = (Math.sqrt(roughness) * (size - 1)) / size + 0.5 / size
  const row = (Math.min(Math.max(Math.abs(NoV) + 1e-5, 0), 1) * (size - 1)) / size + 0.5 / size
  const x = column * size - 0.5,
    y = row * size - 0.5
  const [x0, y0] = [Math.floor(x), Math.floor(y)]
  const [fx, fy] = [x - x0, y - y0]
  return [0, 1, 2, 3].map((k) => {
    const at = (i: number, j: number) => (k < 3 ? texel(y0 + j, x0 + i)[k] : 0)
    return lerp(lerp(at(0, 0), at(1, 0), fx), lerp(at(0, 1), at(1, 1), fx), fy)
  })
}

const shader = shaderRun<{
  sheenViewOf: (N: V3, V: V3, roughness: number) => View
  sheenFuzzEval: (v: View, N: V3, L: V3) => number
  sheenFuzz: (v: View, N: V3, L: V3, fuzz: V3, amount: number, energy: number) => V3
  sheenKeep: (v: View, amount: number) => number
  sheenRect: (v: View, N: V3, r: Quad) => number
  sheenFuzzRoughness: (rough: number) => number
}>(
  wgslModule(SHEEN_LOBE_WGSL, SHEEN_RECT_WGSL),
  ['sheenViewOf', 'sheenFuzzEval', 'sheenFuzz', 'sheenKeep', 'sheenRect', 'sheenFuzzRoughness'],
  {
    ...F32_SCOPE,
    sheenLtcCoefficients: (NoV: number, roughness: number) => table(NoV, roughness),
  },
)

const random = lcgRandom(2207)
const between = (low: number, high: number) => lerp(low, high, random())
const sphere = () => {
  const [z, t] = [between(-1, 1), between(0, 2 * Math.PI)]
  const r = Math.sqrt(1 - z * z)
  return [r * Math.cos(t), r * Math.sin(t), z] as V3
}
const near = (a: number, b: number, relative: number, floor = 1e-6) =>
  Math.abs(a - b) <= relative * Math.max(Math.abs(b), floor)

/** The lobe's value of the definition, in f64: the light moved into the frame (`T1`, `T2`, `N`), by the transform of the
 *  table, its cosine distribution times the Jacobian. */
function twinEval(N: V3, V: V3, L: V3, roughness: number) {
  const NoV = dot(N, V)
  const T1 = unit(V.map((x, k) => x - N[k] * NoV) as V3) as V3
  const T2 = cross(N, T1) as V3
  const [aInv, bInv, albedo] = table(NoV, roughness)
  const local = [dot(T1, L), dot(T2, L), dot(N, L)]
  const wrapped = [aInv * local[0] + bInv * local[2], aInv * local[1], local[2]]
  const inverse = 1 / dot(wrapped as V3, wrapped as V3)
  const jacobian = (aInv * inverse) ** 2
  return { value: Math.max((local[2] / Math.PI) * jacobian, 0), albedo, aInv, bInv }
}

function viewAndLight() {
  const N = sphere()
  let V = sphere()
  while (dot(N, V) < 0.1) V = sphere()
  let L = sphere()
  while (dot(N, L) < 0.02) L = sphere()
  return { N, V, L, roughness: between(0.5, 1) }
}

test('the fuzz roughness is half way between the surface and one, held between the least and one', () => {
  for (const rough of [0, 0.1, 0.5, 0.9, 1]) {
    const expected = Math.min(Math.max(0.5 + 0.5 * rough, MIN_FUZZ_ROUGHNESS), 1)
    assert.ok(near(shader.sheenFuzzRoughness(rough), expected, 1e-6), `${rough}`)
  }
  assert.equal(sheenFuzzRoughness.name, 'sheenFuzzRoughness')
  assert.ok(
    sheenFuzzRoughness.text.includes(`clamp(0.5+0.5*rough,${wgslF32(MIN_FUZZ_ROUGHNESS)},1.0)`),
  )
})

test('a pixel keeps the table read at its cosine and an orthonormal frame of its normal and view', () => {
  for (let round = 0; round < 60; round++) {
    const { N, V, roughness } = viewAndLight()
    const view = shader.sheenViewOf(N, V, roughness)
    const [aInv, bInv, albedo] = table(dot(N, V), roughness)
    assert.ok(near(view.aInv, aInv, 1e-4) && near(view.bInv, bInv, 1e-4, 1e-3), `round ${round}`)
    assert.ok(near(view.albedo, albedo, 1e-4), `round ${round}`)
    assert.ok(Math.abs(dot(view.T1, N)) < 1e-5 && Math.abs(dot(view.T2, N)) < 1e-5)
    assert.ok(Math.abs(dot(view.T1, view.T2)) < 1e-5)
    // The first axis is the view's part across the normal: the view has no component along the second.
    assert.ok(Math.abs(dot(view.T2, V)) < 1e-5)
  }
})

test('a view along the normal has a frame, not a NaN', () => {
  const N: V3 = [0, 0, 1]
  const view = shader.sheenViewOf(N, N, 0.8)
  for (const x of [...view.T1, ...view.T2, view.aInv, view.bInv, view.albedo])
    assert.ok(Number.isFinite(x))
  assert.ok(Math.abs(dot(view.T1, N)) < 1e-6)
  assert.ok(Math.abs(Math.hypot(...view.T1) - 1) < 1e-5)
  const value = shader.sheenFuzzEval(view, N, unit([0.3, 0.2, 0.8]) as V3)
  assert.ok(Number.isFinite(value) && value > 0)
})

test('the lobe of a light is the cosine distribution of the moved direction times the Jacobian', () => {
  let lit = 0
  for (let round = 0; round < 300; round++) {
    const { N, V, L, roughness } = viewAndLight()
    const view = shader.sheenViewOf(N, V, roughness)
    const twin = twinEval(N, V, L, roughness)
    const value = shader.sheenFuzzEval(view, N, L)
    assert.ok(near(value, twin.value, 5e-4, 1e-5), `round ${round}: ${value} against ${twin.value}`)
    if (value > 0) lit++
  }
  assert.ok(lit > 250, `${lit} lit points`)
})

test('a light at or under the horizon adds no fuzz', () => {
  const N: V3 = [0, 0, 1]
  const V = unit([0.4, 0.1, 0.9]) as V3
  const view = shader.sheenViewOf(N, V, 0.7)
  for (const L of [[1, 0, 0], unit([0.5, 0.5, -0.3]), [0, 0, -1]] as V3[])
    assert.equal(shader.sheenFuzzEval(view, N, L), 0)
})

test('the light the fuzz adds is its colour times the amount, the energy, the albedo and the lobe', () => {
  const { N, V, L, roughness } = viewAndLight()
  const view = shader.sheenViewOf(N, V, roughness)
  const twin = twinEval(N, V, L, roughness)
  const added = shader.sheenFuzz(view, N, L, [0.2, 0.5, 0.9], 0.6, 3)
  ;[0.2, 0.5, 0.9].forEach((colour, k) =>
    assert.ok(near(added[k], colour * 0.6 * 3 * twin.albedo * twin.value, 5e-4, 1e-6), `${k}`),
  )
  // No fuzz, no light.
  assert.deepEqual(shader.sheenFuzz(view, N, L, [1, 1, 1], 0, 3), [0, 0, 0])
})

test('the layers under the fuzz keep one minus the amount times its albedo', () => {
  const { N, V, roughness } = viewAndLight()
  const view = shader.sheenViewOf(N, V, roughness)
  const albedo = table(dot(N, V), roughness)[2]
  for (const amount of [0, 0.25, 1])
    assert.ok(near(shader.sheenKeep(view, amount), 1 - amount * albedo, 1e-4), `${amount}`)
  assert.equal(shader.sheenKeep(view, 0), 1)
})

/** A rectangle `size` wide at distance `distance` from the point, in front of the surface, its corners relative to the point. */
function rectangle(N: V3, distance: number, size: number) {
  let centre = sphere()
  while (dot(centre, N) < 0.3) centre = sphere()
  const toPoint = centre.map((x) => -x) as V3
  const U = unit(cross(toPoint, sphere())).map((x) => x * size * between(0.5, 1)) as V3
  const W = unit(cross(U, toPoint)).map((x) => x * size * between(0.5, 1)) as V3
  const C = centre.map((x) => x * distance) as V3
  const corner = (u: number, w: number) => C.map((x, k) => x + u * U[k] + w * W[k]) as V3
  return {
    quad: {
      a: corner(-1, -1),
      b: corner(1, -1),
      c: corner(1, 1),
      d: corner(-1, 1),
      window: 1,
    } as Quad,
    centre,
    area: 4 * Math.hypot(...(cross(U, W) as V3)),
    facing: Math.abs(dot(unit(cross(U, W)) as V3, centre)),
    distance,
  }
}

/** The rectangle's integral of the definition, in f64: each corner moved by the transform and the frame, the exact angle of each
 *  edge, the vector form factor turned toward the polygon, its sine squared and the height wrapped about the horizon. */
function twinRect(N: V3, V: V3, quad: Quad, roughness: number) {
  const NoV = dot(N, V)
  const T1 = unit(V.map((x, k) => x - N[k] * NoV) as V3) as V3
  const T2 = cross(N, T1) as V3
  const [aInv, bInv, albedo] = table(NoV, roughness)
  const move = (q: V3) => {
    const [x, y, z] = [dot(T1, q), dot(T2, q), dot(N, q)]
    return [aInv * x + bInv * z, aInv * y, z] as V3
  }
  const poly = [quad.a, quad.b, quad.c, quad.d].map(move)
  const F = [0, 0, 0]
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % 4]
    const [lp, lq] = [unit(p) as V3, unit(q) as V3]
    const c = cross(lp, lq) as V3
    const s = Math.hypot(...c)
    if (s > 0) {
      const angle = Math.atan2(s, dot(lp, lq))
      for (let k = 0; k < 3; k++) F[k] += (angle * c[k]) / s
    }
  })
  const centre = poly[0].map((x, k) => x + poly[2][k]) as V3
  const flip = dot(F as V3, centre) < 0 ? -1 : 1
  const size = Math.hypot(...F)
  const sinSquared = size / (2 * Math.PI)
  const z = (flip * F[2]) / size
  const s = Math.sqrt(sinSquared)
  const wrapped = z < s ? (s + Math.max(z, -s)) ** 2 / (4 * s) : z
  return albedo * Math.max(sinSquared * wrapped, 0)
}

test('a rectangle is the integral of the lobe over it, near and far, below the horizon too', () => {
  let counted = 0
  for (let round = 0; round < 120; round++) {
    const { N, V, roughness } = viewAndLight()
    const { quad } = rectangle(N, between(2, 8), between(0.5, 3))
    const view = shader.sheenViewOf(N, V, roughness)
    const got = shader.sheenRect(view, N, quad)
    const twin = twinRect(N, V, quad, roughness)
    assert.ok(Number.isFinite(got) && got >= 0, `round ${round}: ${got}`)
    assert.ok(near(got, twin, 2e-3, 1e-5), `round ${round}: ${got} against ${twin}`)
    if (twin > 1e-3) counted++
  }
  assert.ok(counted > 60, `${counted} lit rectangles`)
})

test('a small distant rectangle gives its solid angle times what a point light in its direction gives', () => {
  let counted = 0
  for (let round = 0; round < 80; round++) {
    const { N, V, roughness } = viewAndLight()
    const { quad, centre, area, facing, distance } = rectangle(N, 200, 0.4)
    if (dot(centre, N) < 0.2) continue
    const view = shader.sheenViewOf(N, V, roughness)
    const rect = shader.sheenRect(view, N, quad)
    const point = twinEval(N, V, centre, roughness)
    const solidAngle = (area * facing) / distance ** 2
    const expected = point.albedo * point.value * solidAngle
    assert.ok(near(rect, expected, 2e-2, 1e-9), `round ${round}: ${rect} against ${expected}`)
    counted++
  }
  assert.ok(counted > 40, `${counted} rectangles`)
})

test('a rectangle with no area adds nothing', () => {
  const N: V3 = [0, 0, 1]
  const V = unit([0.2, 0.1, 0.9]) as V3
  const view = shader.sheenViewOf(N, V, 0.8)
  const flat: Quad = { a: [1, 1, 2], b: [1, 1, 2], c: [1, 1, 2], d: [1, 1, 2], window: 1 }
  assert.equal(shader.sheenRect(view, N, flat), 0)
})

test('a cloth’s fuzz is read at its pixel’s fuzz roughness, from the table the light buffer holds: no binding of its own', () => {
  const text = wgslModule(CLOTH_SHEEN_WGSL)
  assert.ok(text.includes('fn clothSheen(N:vec3f,V:vec3f,rough:f32)->SheenView{'))
  assert.ok(text.includes('sheenViewOf(N,V,sheenFuzzRoughness(rough))'))
  assert.ok(text.includes('directLights.sheen['))
  assert.doesNotMatch(text, /@binding/)
})
