// The projection the shadow projection reconstructs each pixel with (`vsmProject.ts`) is the
// camera's projection windowed by the image's jitter (`taaRenderProjection`), where it was the
// render matrix brought back through the view's inverse, `J(P·V)·V⁻¹` (`P·V·V⁻¹` with temporal
// accumulation off). Two proofs here, on `HALTON_SWEEP` cameras of an open world, accumulation on
// and off: (1) it is the product `W·P` value for value, its depth rows P's bits, and P's bits
// with accumulation off; (2) the old round trip differs from it by rounding alone, bounded below.
// What the shader reads of either is compared in `vsmProjectTexel.test.ts`,
// `vsmProjectScreenRay.test.ts` and `vsmProjectFootprint.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { taaRenderMatrix } from '../../../../taa/frame.ts'
import { HALTON_SWEEP } from '../../../../../../math/src/sequence/sweep.fixture.ts'
import { IDENTITY_MATRIX4, multiplyMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { cam, camera, now, roundTrip, rt, viewInverse } from './vsmProject.fixture.ts'

const window = new Float64Array(16),
  windowed = new Float64Array(16)

test('the render projection is W·P value for value, its depth rows and an unjittered one P bits', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const { dx, dy } = camera(i)
    window.set(IDENTITY_MATRIX4)
    window[12] = dx
    window[13] = dy
    multiplyMatrix4(windowed, window, cam.projection)
    for (let k = 0; k < 16; k++) {
      assert.equal(now[k], windowed[k], `camera ${i} entry ${k}`)
      if (k % 4 > 1) assert.ok(Object.is(now[k], cam.projection[k]), `camera ${i} depth ${k}`)
    }
    camera(i, false)
    for (let k = 0; k < 16; k++)
      assert.ok(Object.is(now[k], cam.projection[k]), `camera ${i} still ${k}`)
  }
})

test('the old round trip is the same projection to within 4 units of rounding of its terms', () => {
  // `J(P·V)·V⁻¹` sums four products per entry, `Σ_j JPV[r][j]·V⁻¹[j][c]`, each carrying the
  // rounding of the product and of the inverse; it can only be off by a few units of the largest
  // of them, `4·2⁻⁵²·Σ|terms|`. An exact zero of `W·P` is left out: the round trip leaves a
  // residue there, as large as the eye's distance makes those terms. Measured worst: 2.43.
  const jvp = new Float64Array(16)
  for (const active of [true, false])
    for (let i = 1; i <= HALTON_SWEEP; i++) {
      camera(i, active)
      jvp.set(taaRenderMatrix(rt, cam))
      for (let k = 0; k < 16; k++) {
        if (now[k] === 0) continue
        const r = k % 4,
          c = k - r
        let terms = 0
        for (let j = 0; j < 4; j++) terms += Math.abs(jvp[r + 4 * j] * viewInverse[c + j])
        const at = `camera ${i} ${active ? 'jittered' : 'still'} entry ${k}`
        assert.ok(Math.abs(roundTrip[k] - now[k]) <= 4 * 2 ** -52 * terms, at)
      }
    }
})
