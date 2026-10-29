// The trace of the sun's test of the grooms out of view, and the lines it draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxSphereOf } from './boxSphere.ts'
import { armHairCullTrace, drawHairCull } from './debugCull.ts'
import { createDebugLines } from './debugLines.ts'
import {
  createHairShadowPlan,
  hairReachedByLight,
  hairShadowPlan,
  type HairShadowLight,
} from './shadowCasters.ts'

const VIEW = Float64Array.from([
  1, 0, 0, 10, -1, 0, 0, 10, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, 1, 10, 0, 0, -1, 10,
])
const GROOM = boxSphereOf([-0.5, 5, -0.5, 0.5, 6, 0.5])
const sun = (direction: [number, number, number]): HairShadowLight => ({
  kind: 'directional',
  direction,
})

test('an armed trace asks every sun and keeps what each found; a quiet one stops at the first that reaches', () => {
  const lights = [sun([0, -1, 0]), sun([1, 0, 0]), sun([0, -1, 0])]
  const reach = hairShadowPlan(createHairShadowPlan(), { lights, distance: 20 }, VIEW)
  const { trace } = reach
  armHairCullTrace(trace, false)
  assert.equal(hairReachedByLight(GROOM, reach), true)
  assert.equal(trace.count, 0)
  armHairCullTrace(trace, true)
  assert.equal(hairReachedByLight(GROOM, reach), true)
  assert.deepEqual(
    trace.entries.slice(0, trace.count).map(({ light, reached }) => [light, reached]),
    [
      [0, true],
      [1, false],
      [2, true],
    ],
  )
  // The groom's box, in the world and in the sun's frame extended along its direction.
  const first = trace.entries[0]!
  assert.deepEqual([...first.inWorld], [-0.5, 5, -0.5, 0.5, 6, 0.5])
  assert.ok(first.inLight[3]! - first.inLight[0]! > 40)
})

test("a trace is a view's: another view's test leaves it as it was", () => {
  const lights = [sun([0, -1, 0])]
  const first = hairShadowPlan(createHairShadowPlan(), { lights, distance: 20 }, VIEW)
  const second = hairShadowPlan(createHairShadowPlan(), { lights, distance: 20 }, VIEW)
  armHairCullTrace(first.trace, true)
  hairReachedByLight(GROOM, first)
  hairReachedByLight(GROOM, second)
  assert.equal(first.trace.count, 1)
  assert.equal(second.trace.count, 0)
  assert.notEqual(first.corners, second.corners)
})

test('the trace draws the frustum, one bound for each sun and two boxes for each groom', () => {
  const reach = hairShadowPlan(
    createHairShadowPlan(),
    { lights: [sun([0, -1, 0])], distance: 20 },
    VIEW,
  )
  armHairCullTrace(reach.trace, true)
  hairReachedByLight(GROOM, reach)
  hairReachedByLight(GROOM, reach)
  const lines = createDebugLines()
  lines.begin([0, 0, 0])
  drawHairCull(
    lines,
    reach.trace,
    Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  )
  // 12 of the frustum, 12 of the bound, 24 of each of the two grooms.
  assert.equal(lines.count, 12 + 12 + 2 * 24)
  const empty = createDebugLines()
  empty.begin([0, 0, 0])
  drawHairCull(empty, createHairShadowPlan().trace, new Float64Array(16))
  assert.equal(empty.count, 0)
})
