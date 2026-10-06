import test from 'node:test'
import assert from 'node:assert/strict'
import { BODY_INDEX, CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import { plane } from '../../../sdk-core/src/world/geometry/basic.ts'
import { readPoints } from '../../../sdk-core/src/world/geometry/bounds.ts'
import { castDown } from './module.fixture.ts'
import { CLOTH, flatCloth, FLOOR, settle, softWorld } from './soft.fixture.ts'

/** A turn of a quarter about the vertical after FLAT: its vertices, in its own frame, unchanged. */
const QUARTER = [-0.5, 0.5, 0.5, 0.5]

/** A cloth made 1 m up at the origin and come to rest on the floor (the module has since kept its
 *  body at the centre of its vertices, 1 m under the place it was made), then teleported to `x`,
 *  1 m up, and turned a quarter about the vertical: its vertices before and one step after, in its
 *  frame. */
async function teleported(x: number) {
  const jolt = await softWorld()
  const record = flatCloth(jolt, 1, [])
  const rest = settle(jolt, record, 2)
  const writer = new CommandWriter()
  writer.teleport(CLOTH & BODY_INDEX, [x, 1, 0], QUARTER)
  jolt.step(writer.take(), 0)
  return { jolt, rest, moved: settle(jolt, record, 1 / 60) }
}

test('a soft body teleported and turned within 3 m takes its vertices along as they lie, its simulation kept', async () => {
  const { jolt, rest, moved } = await teleported(2.5)
  for (let i = 0; i < rest.length; i++)
    assert.ok(Math.abs(moved[i] - rest[i]) < 0.01, `${i}: ${rest[i]} → ${moved[i]}`)
  assert.equal(castDown(jolt, 2.5)[0], CLOTH, 'it lies where it was sent')
  assert.equal(castDown(jolt, 0)[0], FLOOR, 'and left where it was')
})

test('a soft body teleported further than 3 m starts again at rest in its rest shape where it was sent', async () => {
  // Past the floor's edge, 20 m out: nothing else there for a ray to hit. Its rest shape, flat, 1 m
  // up where it was sent, a step's fall from rest below it (1.6 mm), not the shape it lay in on the
  // floor 1 m under the place it was made.
  const { jolt, rest, moved } = await teleported(25)
  const flat = readPoints(plane(1, 1, 10, 10).getAttribute('position')!)
  for (let i = 0; i < flat.length; i++)
    assert.ok(Math.abs(moved[i] - flat[i]) < 2.5e-3, `${i}: ${flat[i]} → ${moved[i]}`)
  assert.ok(
    Math.max(...Array.from(rest, (z, i) => (i % 3 === 2 ? -z : 0))) > 0.9,
    'it lay 1 m down',
  )
  assert.equal(castDown(jolt, 25)[0], CLOTH, 'it is where it was sent')
  assert.equal(castDown(jolt, 0)[0], FLOOR, 'and left where it was')
})
