// cone.ts's verdicts on one sweep of 300 000 seeded cases, one in two hostile throughout, the
// others grazing (`coneCases`), held to a golden: the digest of every verdict, taken once its early
// exit and its length rule had been proved, case for case, against the forms they replaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { boxConeRejects } from '../../../../../../../packages/math/src/geometry/cone.ts'
import { coneCases } from '../../../../../../oracles/core/hot-path-math.ts'

/** The SHA-256 of the 300 000 verdicts, one byte each, and how many of them reject. */
const VERDICTS = '3400b26b41ea6e24cf0738516df566dcb1884d2c4d5c203a13e25fd150244408'
const REJECTED = 35_974

test('boxConeRejects keeps its golden verdicts on 300 000 hostile and grazing cases', () => {
  const cases = coneCases(917)
  const verdicts = new Uint8Array(300_000)
  for (let i = 0; i < verdicts.length; i++) {
    const { axis, angle, min, max, world, normal, scale, eye } = cases(i)
    const [ex, ey, ez, ew] = eye
    verdicts[i] = +boxConeRejects(axis, angle, min, max, world, normal, scale, ex, ey, ez, ew)
  }
  assert.equal(
    verdicts.reduce((sum, v) => sum + v, 0),
    REJECTED,
    'rejected cases',
  )
  assert.equal(createHash('sha256').update(verdicts).digest('hex'), VERDICTS)
})
