// The GGX lobe of a sharp highlight is the distribution's own, not 1 − cos²'s stairs. The
// shipped `standardLighting` runs in f32 (`shaderRunF32.fixture.ts`) against the same BRDF in f64
// at the same inputs: a half-vector swept through the lobe's core at the roughness floor, where the
// textbook D was 9 % off and took 2 685 values over 5 000 directions (stair rings).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { F32_SCOPE } from './shaderRunF32.fixture.ts'
import { ROUGHNESS_FLOOR } from './shaderConstants.ts'
import { STANDARD_LIGHTING_WGSL } from './standardLighting.ts'
import { saturate } from '../../../math/src/scalar/reals.ts'

type V3 = number[]
const { standardLighting } = shaderRun<{
  standardLighting: (rgb: V3, metal: number, rough: number, N: V3, V: V3, light: V3) => V3
}>(
  STANDARD_LIGHTING_WGSL,
  [
    'standardLighting',
    'lobeSurface',
    'surfaceLight',
    'standardLobe',
    'ggxDistribution',
    'fresnelSchlick',
  ],
  F32_SCOPE,
)

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (a: V3) => a.map((x) => x / Math.hypot(...a))
const along = (n: V3, side: V3, t: number) =>
  unit(n.map((x, k) => x * Math.cos(t) + side[k] * Math.sin(t)))

/** The metal lobe in f64: D (with the sine of the half-vector from a cross product), the
 *  height-correlated visibility and the Fresnel term, as the shader writes them. */
function metalLobe(rough: number, N: V3, V: V3, L: V3) {
  const [n, v, l] = [N, V, L].map(unit)
  const H = unit([0, 1, 2].map((k) => l[k] + v[k]))
  const [c, nl, nv] = [dot(n, H), dot(n, l), dot(n, v)]
  const a2 = rough ** 4
  const D = a2 / (Math.PI * (1 - c * c + c * c * a2) ** 2)
  const vis =
    0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2) + 1e-7)
  return D * vis * (0.5 + 0.5 * (1 - dot(v, H)) ** 5) * nl
}

test('a sharp highlight is the GGX distribution, to f32, through its core', () => {
  const rough = Number(ROUGHNESS_FLOOR)
  const alpha = rough * rough
  const N = unit([0.3, 0.8, 0.52]).map(Math.fround)
  const T = unit([N[1], -N[0], 0])
  const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]]
  const V = along(N, T, 0.6).map(Math.fround)
  const values = new Set<number>()
  let worst = 0
  for (let i = 0; i < 5000; i++) {
    const phi = i * 2.399963
    const H = along(
      N,
      [0, 1, 2].map((k) => T[k] * Math.cos(phi) + B[k] * Math.sin(phi)),
      (alpha * i) / 5000,
    )
    const L = [0, 1, 2].map((k) => Math.fround(2 * dot(V, H) * H[k] - V[k]))
    const got = standardLighting([0.5, 0.5, 0.5], 1, rough, N, V, [...L, 1])[0]
    worst = Math.max(worst, Math.abs(got / metalLobe(rough, N, V, L) - 1))
    values.add(got)
  }
  // What is left is the half-vector's own rounding: d ln D / dθ reaches 2/α, so H's f32 angle
  // (~1e-7 rad) alone moves D by ~3e-5 at the floor.
  assert.ok(worst < 1e-4, `worst relative error ${worst}`)
  assert.ok(values.size > 4990, `${values.size} values over the core`)
})

/** The displayed byte of a linear value: clamped, sRGB-encoded, quantised to 8 bits. */
const byte = (x: number) => {
  const c = saturate(x)
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055))
}

test('the Fresnel fifth power as products displays the bytes pow displayed', () => {
  const shipped = 'let x=clamp(1.0-cosine,0.0,1.0);let x2=x*x;return f0+(vec3f(1.0)-f0)*(x2*x2*x);'
  assert.ok(STANDARD_LIGHTING_WGSL.includes(shipped))
  const viaPow = shaderRun<{ standardLighting: typeof standardLighting }>(
    STANDARD_LIGHTING_WGSL.replace(
      shipped,
      'return f0+(vec3f(1.0)-f0)*pow(clamp(1.0-cosine,0.0,1.0),5.0);',
    ),
    [
      'standardLighting',
      'lobeSurface',
      'surfaceLight',
      'standardLobe',
      'ggxDistribution',
      'fresnelSchlick',
    ],
    F32_SCOPE,
  ).standardLighting
  const N = unit([0.3, 0.8, 0.52]).map(Math.fround)
  const T = unit([N[1], -N[0], 0])
  const B = [N[1] * T[2] - N[2] * T[1], N[2] * T[0] - N[0] * T[2], N[0] * T[1] - N[1] * T[0]]
  const around = (theta: number, phi: number) =>
    along(
      N,
      [0, 1, 2].map((k) => T[k] * Math.cos(phi) + B[k] * Math.sin(phi)),
      theta,
    ).map(Math.fround)
  let pixels = 0,
    worst = 0
  // Grazing views and lights, where the fifth power weighs most, through every roughness, metal,
  // albedo and the energies that span the displayed range.
  for (const rough of [Number(ROUGHNESS_FLOOR), 0.2, 0.45, 0.7, 1])
    for (const metal of [0, 0.5, 1])
      for (const rgb of [
        [0.9, 0.6, 0.2],
        [0.05, 0.3, 0.95],
      ])
        for (let v = 0; v < 6; v++)
          for (let l = 0; l < 24; l++)
            for (const energy of [0.25, 1, 3]) {
              const V = around(0.05 + 0.29 * v, 0.4)
              const L = around(0.06 * l + 0.02, 0.4 + 0.7 * l)
              const got = standardLighting(rgb, metal, rough, N, V, [...L, energy])
              const was = viaPow(rgb, metal, rough, N, V, [...L, energy])
              for (let c = 0; c < 3; c++) {
                assert.equal(byte(got[c]), byte(was[c]), `${rough} ${metal} ${v} ${l} ${energy}`)
                if (was[c] > 1e-6) worst = Math.max(worst, Math.abs(got[c] / was[c] - 1))
              }
              pixels++
            }
  // Two f32 products against a correctly rounded power: a few units in the last place.
  assert.ok(worst < 1e-6, `worst relative deviation ${worst} over ${pixels} pixels`)
})
