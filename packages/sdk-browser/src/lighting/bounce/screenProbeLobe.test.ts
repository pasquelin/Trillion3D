// The directions a pixel asks light from, summed over a probe's footprint, are the reference's: the cosine lobe of the normal as the
// spherical-harmonic transfer of the diffuse lobe (bands scaled by π, 2π/3 and π/4), or the constant term alone for a pixel lit from both sides.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { screenDataShader } from './screen/screenDataWgsl.ts'

type Vector = [number, number, number]

/** The nine coefficients of the diffuse transfer of a normal (exponent one) and the nine harmonics of a direction, in the order and signs
 *  of the reference's three-band basis (a `y`, `z`, `x` first band). */
const REFERENCE = {
  basis: ([x, y, z]: Vector) => [
    0.282095,
    -0.488603 * y,
    0.488603 * z,
    -0.488603 * x,
    1.092548 * x * y,
    -1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    -1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ],
  bands: [Math.PI, ...Array(3).fill((2 * Math.PI) / 3), ...Array(5).fill(Math.PI / 4)],
}
const transfer = (n: Vector) => REFERENCE.basis(n).map((c, k) => c * REFERENCE.bands[k])

const { spPdfLobe, spBasis } = shaderRun<{
  spPdfLobe: (n: Vector, spherical: boolean) => number[]
  spBasis: (d: Vector) => number[]
}>(screenDataShader([4, 2]), ['spPdfLobe', 'spBasis'], {})

const unit = (v: Vector): Vector => {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}
const dot = (a: number[], b: number[]) => a.reduce((sum, value, k) => sum + value * b[k], 0)

test('a pixel facing a normal asks the diffuse transfer of it: each coefficient the reference’s up to the sign of its harmonic, and the same density in every direction', () => {
  for (const n of [
    unit([0.3, -0.5, 0.8]),
    unit([1, 0, 0]),
    unit([0, 1, 0]),
    unit([-0.2, 0.1, -0.9]),
  ]) {
    const lobe = spPdfLobe(n, false)
    transfer(n).forEach((c, k) =>
      assert.ok(Math.abs(Math.abs(lobe[k]) - Math.abs(c)) < 2e-6, `${n} term ${k}`),
    )
    for (const d of [unit([0, 0, 1]), unit([0.4, 0.7, -0.2]), n, unit([-n[0], -n[1], -n[2]])])
      assert.ok(
        Math.abs(dot(lobe, spBasis(d)) - dot(transfer(n), REFERENCE.basis(d))) < 2e-5,
        `${n} ${d}`,
      )
  }
})

test('a pixel lit from both sides asks every direction alike: the constant term alone, one', () => {
  assert.deepEqual(spPdfLobe(unit([0.3, -0.5, 0.8]), true), [1, 0, 0, 0, 0, 0, 0, 0, 0])
  const density = dot(spPdfLobe([0, 0, 1], true), spBasis(unit([0.4, 0.7, -0.2])))
  assert.ok(Math.abs(density - REFERENCE.basis([0, 0, 1])[0]) < 1e-6)
})
