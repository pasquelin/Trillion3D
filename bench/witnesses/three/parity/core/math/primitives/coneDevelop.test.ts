// cone.ts's verdicts on one sweep of 300 000 seeded cases, one in two hostile throughout, the
// others grazing (`coneCases`), against the cone's definition written out here: the box's sphere,
// the turned axis normalized, the view vector, every length paid and the verdict then — no early
// exit. The early exit claims the same verdict, bit for bit, on every input.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxConeRejects } from '../../../../../../../packages/math/src/geometry/cone.fixture.ts'
import { coneRejects } from '../../../../../../../packages/math/src/projection/projectionOracles.ts'
import { length3 } from '../../../../../../../packages/math/src/vector/vector.ts'
import { coneCases } from '../../../../../../oracles/core/hot-path-math.ts'

type Case = ReturnType<ReturnType<typeof coneCases>>

/** The definition, every step taken: what `boxConeRejects` returns for `c`. */
function definition({ axis, angle, min, max, world: e, normal: n, scale, eye }: Case) {
  const [ex, ey, ez, ew] = eye
  const l = [0, 1, 2].map((k) => (min[k] + max[k]) * 0.5)
  const w = 1 / (e[3] * l[0] + e[7] * l[1] + e[11] * l[2] + e[15])
  const c = [0, 1, 2].map((k) => (e[k] * l[0] + e[4 + k] * l[1] + e[8 + k] * l[2] + e[12 + k]) * w)
  const turned = [0, 1, 2].map((k) => n[k] * axis[0] + n[3 + k] * axis[1] + n[6 + k] * axis[2])
  const al = length3(turned[0], turned[1], turned[2])
  if (!(al > 0)) return false
  const a = turned.map((v) => v * (1 / al))
  const v = [ex - c[0] * ew, ey - c[1] * ew, ez - c[2] * ew]
  const vl = length3(v[0], v[1], v[2])
  if (!(vl > 0)) return false
  const half = [0, 1, 2].map((k) => (max[k] - min[k]) * 0.5)
  const radius = length3(half[0], half[1], half[2]) * scale
  const d = length3(ex - c[0] * ew, ey - c[1] * ew, ez - c[2] * ew)
  let spread = Math.PI
  if (d > radius * ew) {
    const t = (radius * ew) / d
    spread = Math.asin(t < 0 ? 0 : t > 1 ? 1 : t)
  }
  const dot = Math.min(1, Math.max(-1, (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) / vl))
  try {
    return coneRejects(dot, angle, spread)
  } catch {
    return false
  }
}

test('boxConeRejects gives the definition’s verdict on 300 000 hostile and grazing cases', () => {
  const cases = coneCases(917)
  const seen = [0, 0]
  for (let i = 0; i < 300_000; i++) {
    const c = cases(i)
    const [ex, ey, ez, ew] = c.eye
    const { axis, angle, min, max, world, normal, scale } = c
    const verdict = boxConeRejects(axis, angle, min, max, world, normal, scale, ex, ey, ez, ew)
    if (verdict !== definition(c)) assert.fail(`case ${i}: ${JSON.stringify(c)}`)
    seen[+verdict]++
  }
  assert.ok(seen[0] > 0 && seen[1] > 0, `both verdicts met: ${seen}`)
})
