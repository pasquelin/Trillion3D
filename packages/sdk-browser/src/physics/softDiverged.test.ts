import test from 'node:test'
import assert from 'node:assert/strict'
import { BODY_INDEX, CommandWriter, EVENT, FLAG } from '../../../sdk-core/src/physics/index.ts'
import { events, startModule, type Module } from './module.fixture.ts'
import { addBox, BOX, CLOTH, flatCloth, FLOOR, settle, softWorld } from './soft.fixture.ts'
import { stateDump } from './stateDump.fixture.ts'

/** `stateDump`'s motion as the reference module simulates this scene, with each step's events
 *  hashed as a set. It proves the poses, the soft words and the event set equal the reference's,
 *  not its event order: the canonical order of the merged records is the accepted route. A soft
 *  body takes a 1 cm thickness (`SOFT_VERTEX_RADIUS`): the same module built with a radius of 0
 *  gives the reference's own, `d54edc7d…` (motion) and `014b9452…` (whole), so the thickness alone
 *  moves it. A contact's impulse takes its bodies' turn and bounce: with every event's impulse
 *  word zeroed, the modules with and without the turn and bounce give the same two hashes
 *  (`167f1388…` and `6bd49e2d…`), so only the impulses move. */
const DEVELOP_MOTION = '308bb20ef804ca2a490e90baeea7180d13f75878210c9854a8f3d0e99d4e44c9'
/** `stateDump` whole, vertices bit for bit, as the write-back of one matrix per body gives it, the
 *  events in the order the engine sent them (see `stateDump`), not the module's callback order. */
const FULL_DUMP = 'd5cc715a70b4c1b33da212a274cff7973116a4651951e7c0f42b78f51f7d7ec2'

test('a finite scene steps exactly as before, but for pinned cloths that never stretch and the thickness of soft bodies', async () => {
  assert.deepEqual(stateDump(await startModule()), { motion: DEVELOP_MOTION, full: FULL_DUMP })
})

/** A module whose cloth rests on the floor and on a box (the pairs entered), all wanting events;
 *  then the body `index` sent to `x`, not finite, in a step of no time. */
async function spoiled(index: number, x: number, cone = false) {
  const jolt = await softWorld()
  const record = flatCloth(jolt, 1, [], true)
  addBox(jolt, 1, 0.1, FLAG.events)
  settle(jolt, record, 2)
  const writer = new CommandWriter()
  // A view cone: a body gone non-finite is in none, and is named all the same.
  if (cone) writer.view([0, 1, 5], [0, 0, -1], 0.5, 400)
  writer.teleport(index & BODY_INDEX, [x, 1, 0], [0, 0, 0, 1])
  const posed = jolt.step(writer.take(), 0)
  return { jolt, record, posed }
}

/** The bodies the last step's leaves named beside `id`, sorted. */
const leftBy = (jolt: Module, id: number) =>
  events(jolt)
    .filter((e) => e[0] === EVENT.end && (e[1] === id || e[2] === id))
    .map((e) => (e[1] === id ? e[2] : e[1]))
    .sort()

test('a soft body whose vertices go non-finite sends none, is named once, and leaves', async () => {
  for (const x of [NaN, Infinity, -Infinity]) {
    const { jolt, record } = await spoiled(CLOTH, x)
    assert.equal(jolt.soft().length, 0, `${x}: no vertex reaches the page`)
    assert.deepEqual(jolt.diverged(), [CLOTH], `${x}: named`)
    assert.deepEqual(leftBy(jolt, CLOTH), [FLOOR, BOX].sort(), `${x}: its pairs left`)
    // Commands the page wrote before it heard are skipped; its removal frees the slot.
    const writer = new CommandWriter()
    writer.teleport(CLOTH & BODY_INDEX, [0, 1, 0], [0, 0, 0, 1])
    jolt.step(writer.take(), 1 / 60)
    assert.deepEqual(jolt.diverged(), [], `${x}: named once`)
    writer.remove(CLOTH & BODY_INDEX)
    jolt.step(writer.take(), 0)
    flatCloth(jolt, 1, [])
    assert.ok(settle(jolt, record, 1 / 60).every(Number.isFinite), `${x}: a new body takes it`)
  }
})

test('a rigid body whose pose goes non-finite sends none, is named once, and leaves', async () => {
  for (const [x, cone] of [NaN, Infinity, -Infinity].flatMap(
    (x) =>
      [
        [x, false],
        [x, true],
      ] as const,
  )) {
    const { jolt, posed } = await spoiled(BOX, x, cone)
    assert.equal(posed, 0, `${x}: no pose reaches the page`)
    assert.deepEqual(jolt.diverged(), [BOX], `${x}: named`)
    assert.deepEqual(leftBy(jolt, BOX), [FLOOR, CLOTH].sort(), `${x}: its pairs left`)
    jolt.step(null, 1 / 60)
    assert.deepEqual(jolt.diverged(), [], `${x}: named once`)
  }
})
