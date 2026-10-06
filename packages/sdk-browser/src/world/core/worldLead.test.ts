import test from 'node:test'
import assert from 'node:assert/strict'
import { box } from '../../../../sdk-core/src/world/geometry/basic.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { fakePhysicsWorld, idleTick, poseRecord } from '../../physics/worker.fixture.ts'
import { createWorldFrames } from './worldFrames.ts'

// A world whose host leads (`interactive: false`) runs the physics in `world.render()`
// through the loop's own step, with no controller: it no longer simulates nothing. No Node fixture
// opens a world's session, so the frames and the physics are driven as `render()` drives them.
test('a host-led frame runs the physics as the loop does: its falling body moves', async (t) => {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const { scene, physics, worker, restore } = await fakePhysicsWorld()
  try {
    const crate = new Mesh(box(), new Material('meshStandard'))
    crate.physics = 'dynamic'
    crate.position.set(0, 5, 0)
    scene.add(crate)
    const frames = createWorldFrames()
    const render = () => frames.step(null, scene, physics)
    render()
    assert.equal(worker.words.length, 1, 'the frame sent the body to the worker')
    const id = physics.session()!.engineIdOf(crate)
    // Each frame owes a step, which the worker takes and delivers before the next frame.
    for (const [step, y] of [
      [1, 4.9],
      [2, 4.6],
    ]) {
      now += 17
      render()
      const fell = poseRecord(id, [0, y, 0, 0, 0, 0, 1])
      worker.onmessage({
        data: { ...idleTick, buffer: fell.buffer, poses: 1, steps: 1, step, active: 1 },
      })
    }
    // Drawn a step behind the frames' time: there the next frame, then on it.
    now += 17
    render()
    assert.equal(crate.position.y.toFixed(2), '4.89', 'between the two steps that bracket it')
    now += 17
    render()
    assert.equal(crate.position.y.toFixed(1), '4.6', 'drawn where the worker let it fall')
    physics.dispose()
  } finally {
    restore()
  }
})
