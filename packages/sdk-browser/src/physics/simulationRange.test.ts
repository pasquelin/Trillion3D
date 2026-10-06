import test from 'node:test'
import assert from 'node:assert/strict'
import { OP, VIEW_WORDS } from '../../../sdk-core/src/physics/index.ts'
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import { fakePhysicsWorld } from './worker.fixture.ts'
import { createWorldPhysics } from './worldPhysics.ts'

/** The range the frame's VIEW command sends, the flush's last command in an empty scene; `null`
 *  when the frame sent none (the view did not change). */
function sentRange(world: Awaited<ReturnType<typeof fakePhysicsWorld>>) {
  const before = world.worker.words.length
  world.physics.frame()
  if (world.worker.words.length === before) return null
  const words = world.worker.words.at(-1)!
  const view = words.subarray(words.length - VIEW_WORDS)
  assert.equal(view[0], OP.view)
  return new Float32Array(view.buffer, view.byteOffset, VIEW_WORDS)[8]
}

test("bodies are simulated within the camera's draw distance until a range is set", async () => {
  const world = await fakePhysicsWorld()
  try {
    const far = new Camera('perspective').far
    assert.equal(world.physics.handle.simulationRange, null)
    assert.equal(sentRange(world), far, 'the default: camera.far, as before the option')
    assert.equal(sentRange(world), null, 'an unchanged view is not sent again')
    world.physics.handle.simulationRange = 250
    assert.equal(sentRange(world), 250)
    for (const wrong of [0, -1, NaN, Infinity, -Infinity])
      assert.throws(() => (world.physics.handle.simulationRange = wrong), RangeError, `${wrong}`)
    assert.equal(world.physics.handle.simulationRange, 250, 'a refused range leaves the last one')
    world.physics.handle.simulationRange = null
    assert.equal(sentRange(world), far, 'null follows the camera again')
  } finally {
    world.restore()
  }
})

test('createWorld takes the simulation range, and refuses one that is no distance', () => {
  // Switched off at once: options turn the physics on, and no session is wanted here.
  const make = (simulationRange: number | null) => {
    const runtime = { invalidate() {}, explorer: null }
    const world = createWorldPhysics(runtime, new Group(), () => new Camera('perspective'), {
      simulationRange,
    })
    world.handle.enabled = false
    return world
  }
  assert.equal(make(40).handle.simulationRange, 40)
  assert.equal(make(null).handle.simulationRange, null)
  assert.throws(() => make(0), RangeError)
})
