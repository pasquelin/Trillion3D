// cone.ts against its develop verdict: `boxConeRejects` before the length rule paid the box radius,
// the eye distance and the view vector by `Math.hypot`, the turned axis by the plain root of its
// squares. The rule's range takes `hypot` wherever the plain sum leaves the normal band, so the
// verdicts differ only where develop's plain axis root overflowed or underflowed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxConeRejects } from '../../../../../../../packages/sdk-core/src/index.ts'
import { length3 } from '../../../../../../../packages/math/src/vector/vector.ts'
import {
  boxConeRejectsBefore,
  coneCases,
  HYPOT_LENGTHS,
} from '../../../../../../oracles/core/hot-path-math.ts'

/** A number of the ordinary range: zero or finite between 1e-100 and 1e100 in magnitude. */
const ordinary = (v: number) => v === 0 || (Math.abs(v) >= 1e-100 && Math.abs(v) <= 1e100)

test('boxConeRejects keeps its develop verdict on every ordinary case of 300 000', () => {
  const cases = coneCases(917)
  let ordinaryCases = 0,
    axisRange = 0
  for (let i = 0; i < 300_000; i++) {
    const c = cases(i)
    const { axis, angle, min, max, world, normal, scale, eye } = c
    const [ex, ey, ez, ew] = eye
    const verdict = boxConeRejects(axis, angle, min, max, world, normal, scale, ex, ey, ez, ew)
    const before = boxConeRejectsBefore(
      axis,
      angle,
      min,
      max,
      world,
      normal,
      scale,
      eye,
      HYPOT_LENGTHS,
    )
    const plain = [axis, [angle], min, max, world, normal, [scale], eye].every((v) =>
      v.every(ordinary),
    )
    if (plain) ordinaryCases++
    if (verdict === before) continue
    assert.ok(!plain, `an ordinary case differs: ${JSON.stringify(c)}`)
    // Every other difference is the axis length alone: develop's lengths with the rule's axis
    // root give the verdict back.
    const ruleAxis = { ...HYPOT_LENGTHS, axisLength: length3 }
    assert.equal(
      verdict,
      boxConeRejectsBefore(axis, angle, min, max, world, normal, scale, eye, ruleAxis),
      JSON.stringify(c),
    )
    axisRange++
  }
  assert.ok(ordinaryCases > 100_000, `${ordinaryCases} ordinary cases`)
  assert.ok(axisRange < 1000, `${axisRange} hostile axes, each the plain root's range`)
})
