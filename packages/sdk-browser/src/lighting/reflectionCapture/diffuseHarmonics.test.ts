// The cube's smallest mips from the harmonics (`shCubeMain`, `captureWgsl.ts`): the packed harmonics evaluate the cosine-weighted mean radiance (the light
// the exhaustive path, `irradianceCubeMain`, gives), where the reference's evaluation of the harmonics alone returns the radiance they reconstruct. The
// shader's two formulas are written out here, over the engine's own basis, and met against a numeric integral.
import test from 'node:test'
import assert from 'node:assert/strict'
import { IRRADIANCE_TERMS } from '../../../../sdk-core/src/scene/core/irradianceTerms.ts'

type V3 = readonly [number, number, number]
/** A radiance with a constant, a linear and a quadratic part: within the nine terms. */
const radiance = (d: V3) => 1 + 0.5 * d[2] + 0.3 * d[0] + 0.2 * (3 * d[2] * d[2] - 1)
const sphere = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(1 - z * z)
    const phi = i * Math.PI * (3 - Math.sqrt(5))
    return [r * Math.cos(phi), r * Math.sin(phi), z] as V3
  })
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The basis at the unit `d`: the engine's nine terms (the contract's constants times the polynomials of `irradianceTerms`). */
function basis(d: V3) {
  const [x, y, z] = d
  const polynomials = [1, y, z, x, x * y, y * z, 3 * z * z - 1, x * z, x * x - y * y]
  return IRRADIANCE_TERMS.map((term, k) => term.contract * polynomials[k])
}

const points = sphere(20000)
const weight = (4 * Math.PI) / points.length
/** The nine coefficients of the radiance: its integral against each term. */
const coefficients = Array.from({ length: 9 }, (_, k) =>
  points.reduce((sum, d) => sum + radiance(d) * basis(d)[k] * weight, 0),
)

/** `packHarmonics` of the irradiance program, for one channel: the seven vectors' lanes. */
function packed() {
  const s = coefficients
  const sqrtPi = Math.sqrt(Math.PI)
  const c0 = 1 / (2 * sqrtPi),
    c1 = Math.sqrt(3) / (3 * sqrtPi),
    c2 = Math.sqrt(15) / (8 * sqrtPi),
    c3 = Math.sqrt(5) / (16 * sqrtPi),
    c4 = 0.5 * c2
  return {
    first: [-c1 * s[3], -c1 * s[1], c1 * s[2], c0 * s[0] - c3 * s[6]] as const,
    second: [c2 * s[4], -c2 * s[5], 3 * c3 * s[6], -c2 * s[7]] as const,
    last: c4 * s[8],
  }
}

/** `packedIrradiance`: the harmonics' light along the unit `d`. */
function evaluatePacked(d: V3) {
  const p = packed()
  const v = [d[0], d[1], d[2], 1]
  const quadratic = [v[0] * v[1], v[1] * v[2], v[2] * v[2], v[2] * v[0]]
  const first = p.first.reduce((s, c, i) => s + c * v[i], 0)
  const second = p.second.reduce((s, c, i) => s + c * quadratic[i], 0)
  return Math.max(0, first + second + p.last * (v[0] * v[0] - v[1] * v[1]))
}

/** The cosine-weighted mean radiance about `n`: what the exhaustive path converges to. */
const cosineMean = (n: V3) =>
  points.reduce((sum, d) => sum + radiance(d) * Math.max(dot(n, d), 0) * weight, 0) / Math.PI

test('the packed harmonics give the cosine-weighted mean radiance, the harmonics alone do not', () => {
  let differs = false
  for (const n of [
    [0, 0, 1],
    [1, 0, 0],
    [0, 0.6, 0.8],
    [-0.6, 0, -0.8],
  ] as V3[]) {
    const expected = cosineMean(n)
    // Within the three bands' truncation of the cosine lobe and the quadrature.
    assert.ok(Math.abs(evaluatePacked(n) - expected) < 0.02 * expected, `along ${n}`)
    const reconstructed = basis(n).reduce((sum, b, k) => sum + b * coefficients[k], 0)
    // The radiance itself differs from the light of the hemisphere wherever the radiance is not constant.
    differs ||= Math.abs(reconstructed - expected) > 0.05
  }
  assert.ok(differs, 'the radiance and the cosine-weighted mean differ along some normal')
})
