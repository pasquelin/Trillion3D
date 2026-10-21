// `normalMatrix3` (`packages/math/src/matrix/matrix3.ts`) replaces a host-library normal-matrix
// call: the function alone, on hostile 3×3s (shear, non-conformal, NaN, ±0) where the host library
// stays the oracle.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { assertBits } from '../../../../../../../tests/kit/assert/bits.ts'
import { normalMatrix3 } from '../../../../../../../packages/math/src/matrix/matrix3.ts'

/** The nine coefficients of a host-library 3×3, column-major, flat. */
const a9 = (m: THREE.Matrix3) => Float64Array.from(m.elements)

const HOSTILE_CASES: THREE.Matrix4[] = [
  // Shear: y pushes x, z pushes y.
  new THREE.Matrix4().set(1, 0, 0, 0, 0.6, 1, 0, 0, 0, 0.3, 1, 0, 0, 0, 0, 1),
  // Non-uniform scale, one negative axis.
  new THREE.Matrix4().makeScale(2, -3, 0.5),
]

for (const [i, m] of HOSTILE_CASES.entries()) {
  test(`normalMatrix3 === Matrix3.getNormalMatrix, hostile case ${i}`, () => {
    const ref = new THREE.Matrix3().getNormalMatrix(m)
    const out = new Float64Array(9)
    normalMatrix3(out, m.elements)
    assertBits(out, a9(ref), 'normal matrix')
  })
}

test("normalMatrix3: on a non-finite 3×3, the engine convention replaces the host library's", () => {
  // Parity with the host library holds on REGULAR matrices, and it stops there: the engine has its own
  // convention for singular matrices (the adjugate, `packages/math/src/matrix/matrix3.ts`) and for non-finite scales
  // (nine zeros, the rule of `packages/math/src/matrix/singular.ts`, that of the WGSL kernel). The host library, on this NaN
  // mixed with ±0, propagates NaNs into the nine terms — therefore into lighting. This test
  // holds the gap, rather than let parity one day take it back.
  const m = new THREE.Matrix4().set(NaN, 0, 0, 0, 0, -0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  const ref = a9(new THREE.Matrix3().getNormalMatrix(m))
  assert.ok(
    [...ref].every((v) => Number.isNaN(v)),
    `the reference used to yield nine NaNs, got ${[...ref]}`,
  )
  const out = new Float64Array(9).fill(9)
  normalMatrix3(out, m.elements)
  assertBits(out, new Float64Array(9), 'engine normal matrix')
})
