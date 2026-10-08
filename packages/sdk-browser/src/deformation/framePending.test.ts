// `pending` reads each placement's staleness once a frame and the image's `update` of that frame
// takes that answer: the records are those an update without it writes, a frame held after a quiet
// `pending` reads its inputs again at the next, and an answer noted for another frame or for none
// is never taken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationFrame } from './frame.ts'
import { deformedOf } from './source.ts'
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'

const IDENTITY = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }

/** A placement morphed by one target, and the weights that move it. */
function morphed() {
  const mesh = { morphTargetInfluences: [0.5] }
  const placed = deformedOf(mesh, { deformation: { joints: [], targets: [2] } }, IDENTITY)!
  return { mesh, frame: createDeformationFrame([placed]) }
}

const quiet = () => false

test('an update after pending writes the records an update alone writes', () => {
  const asked = morphed(),
    alone = morphed()
  for (const [tick, weight] of [0.5, 0.75, 0.75, 0.25, 0.25, 0.25].entries()) {
    asked.mesh.morphTargetInfluences[0] = alone.mesh.morphTargetInfluences[0] = weight
    asked.frame.pending(tick)
    assert.equal(asked.frame.update(quiet, tick), alone.frame.update(quiet))
    assert.deepEqual([...asked.frame.block], [...alone.frame.block])
    assert.deepEqual(
      [asked.frame.moving[0], asked.frame.dirty[0], asked.frame.reach[0]],
      [alone.frame.moving[0], alone.frame.dirty[0], alone.frame.reach[0]],
    )
  }
})

test('a frame held after a quiet pending reads its inputs again at the next', () => {
  const { mesh, frame } = morphed()
  frame.update(quiet)
  frame.update(quiet)
  assert.equal(frame.pending(), false)
  mesh.morphTargetInfluences[0] = 1
  assert.equal(frame.pending(), true, 'the weight moved while the frame was held')
  assert.equal(frame.update(quiet), true)
  assert.equal(frame.moving[0], 1)
})

test('an answer noted for another frame, or outside any, is read again', () => {
  for (const noted of [3, undefined]) {
    const { mesh, frame } = morphed()
    frame.update(quiet, 1)
    frame.update(quiet, 2)
    assert.equal(frame.pending(noted), false)
    mesh.morphTargetInfluences[0] = 1
    assert.equal(frame.update(quiet, 4), true, 'the weight moved after the barrier read it')
    assert.equal(frame.moving[0], 1)
  }
})

// A host write moves a placement's world after the hold read its staleness (`pending`, the world
// it compares not yet refreshed): the refresh forgets the answer (`forget`, called by
// `uploadWorlds`), and the frame's update writes and uploads the new world of a placement the waves
// alone deform — no joint, weight or soft source would have told it.
test('a world the host moves after pending is written by the update once the answer is forgotten', () => {
  const world = { elements: new Float64Array(IDENTITY.elements) }
  const waves = new WaterSurface({
    level: 0,
    waves: [{ direction: [1, 0], wavelength: 8, amplitude: 0.5, steepness: 0.2 }],
  })
  const placed = deformedOf({ waves }, undefined, world)!
  const frame = createDeformationFrame([placed])
  frame.update(quiet, 0)
  frame.update(quiet, 1)
  assert.equal(frame.pending(2), false, 'still: the hold reads the world before the refresh')
  world.elements[12] = 5
  frame.forget()
  assert.equal(frame.update(quiet, 2), true, 'the moved world is uploaded')
  assert.equal(frame.moving[0], 1)
})
