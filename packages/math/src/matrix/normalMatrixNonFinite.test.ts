// `normalMatrix3` (`matrix3.ts`): on a non-finite 3×3, the engine's own convention.
import test from 'node:test'
import { assertBits } from '../../../../tests/kit/assert/bits.ts'
import { normalMatrix3 } from './matrix3.ts'

test('normalMatrix3: on a non-finite 3×3, the engine convention is nine zeros', () => {
  // The engine has its own convention for singular matrices (the adjugate, `matrix3.ts`) and for
  // non-finite scales (nine zeros, the rule of `singular.ts`, that of the WGSL kernel).
  const m = [NaN, 0, 0, 0, 0, -0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const out = new Float64Array(9).fill(9)
  normalMatrix3(out, m)
  assertBits(out, new Float64Array(9), 'engine normal matrix')
})
