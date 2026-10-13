// A late tick (`t > 1`): a driven car's wheels are moved on from their newest state by the law the
// body goes on by (`extrapolateAll`), at the velocities of their own last step — the suspension on
// its line, the spin about its axis at its rate —, which is the arc and the line of that step
// carried on: a frame half a step late, or a whole one, shows the wheel where the step's motion
// takes it, never frozen on the newest.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  slerpArc,
  slerpOnArc,
  normalizeQuaternionAt,
} from '../../../math/src/quaternion/quaternion.ts'
import { vehicleRig } from './vehicles.fixture.ts'

type Pose = { p: number[]; q: Float64Array }

const poseOf = (wheel: {
  position: { x: number; y: number; z: number }
  quaternion: { x: number; y: number; z: number; w: number }
}): Pose => ({
  p: [wheel.position.x, wheel.position.y, wheel.position.z],
  q: Float64Array.of(
    wheel.quaternion.x,
    wheel.quaternion.y,
    wheel.quaternion.z,
    wheel.quaternion.w,
  ),
})

test('a car driven at speed draws its wheels past a late tick as their last step carries them on', async () => {
  const rig = await vehicleRig('car')
  rig.hold({ throttle: 1 }, 3)
  assert.ok(rig.vehicle.speed > 8, `driven: ${rig.vehicle.speed} m/s`)
  // Two steps, the page waiting for the next after each, as a live worker's page does.
  rig.run(1, true)
  const before = rig.wheels.map(poseOf)
  rig.run(1, true)
  const newest = rig.wheels.map(poseOf)
  const arc = new Float64Array(3),
    expected = new Float64Array(4)
  for (const late of [1.25, 1.5, 2]) {
    rig.vehicles.apply(late, true)
    rig.wheels.forEach((wheel, i) => {
      const drawn = poseOf(wheel)
      // The line of the last step carried on: `to + (late − 1) (to − from)`.
      for (let k = 0; k < 3; k++) {
        const on = newest[i].p[k] + (late - 1) * (newest[i].p[k] - before[i].p[k])
        assert.ok(
          Math.abs(drawn.p[k] - on) <= 1e-9,
          `wheel ${i}, ${late}, axis ${k}: ${drawn.p[k]} ${on}`,
        )
      }
      // The arc of the last step carried on (the turn composed with the rest on the right moves
      // along the same arc): `slerpOnArc` past its end.
      slerpArc(arc, 0, before[i].q, 0, newest[i].q, 0)
      slerpOnArc(expected, 0, before[i].q, 0, newest[i].q, 0, late, arc, 0)
      normalizeQuaternionAt(expected, 0, expected[0], expected[1], expected[2], expected[3])
      const sign = expected.reduce((dot, value, k) => dot + value * drawn.q[k], 0) < 0 ? -1 : 1
      for (let k = 0; k < 4; k++)
        assert.ok(
          Math.abs(sign * drawn.q[k] - expected[k]) <= 1e-9,
          `wheel ${i}, ${late}, ${k}: ${drawn.q[k]} ${expected[k]}`,
        )
      // Not frozen: the spin went on past the newest.
      const moved = Math.abs(drawn.q.reduce((dot, value, k) => dot + value * newest[i].q[k], 0))
      assert.ok(moved < 1 - 1e-6, `wheel ${i} spun on at ${late}`)
    })
  }
  // The next tick lands: drawn on its state, exactly.
  rig.run(1, true)
  const landed = rig.wheels.map(poseOf)
  rig.vehicles.apply(1, true)
  rig.wheels.forEach((wheel, i) => assert.deepEqual(poseOf(wheel), landed[i]))
})
