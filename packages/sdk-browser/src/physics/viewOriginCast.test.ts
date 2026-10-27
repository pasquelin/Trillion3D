// The cast of the view origin (`viewOriginCast.ts`): its revision never goes back across sessions, its
// query stops at the bodies of every object type, and a hit is read as a distance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../math/src/constants.ts'
import {
  COLLISION_CHANNELS,
  objectTypeWords,
} from '../../../sdk-core/src/physics/collisionChannels.ts'
import { CAST_AT, CAST_STOP, HIT_AT, HIT_WORDS } from '../../../sdk-core/src/physics/layout.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { createViewOriginCast, rayHitDistance } from './viewOriginCast.ts'
import type { PhysicsSession } from './session/session.ts'

/** A session of a revision the test moves, answering with the queries it was asked. */
function session(revision = 0) {
  const asked: Uint32Array[] = []
  const state = { revision }
  const fake = {
    revision: () => state.revision,
    engineIdOf: (node: Object3D) => (node === body ? 3 : -1),
    castTo: (query: Uint32Array) => void asked.push(query.slice()),
  }
  return { state, asked, session: fake as unknown as PhysicsSession }
}
const body = {} as Object3D

test('the revision only grows, whichever sessions come and go', () => {
  let current: PhysicsSession | null = null
  const cast = createViewOriginCast(() => current)
  const seen: number[] = [cast.revision()]
  const first = session(0)
  current = first.session
  seen.push(cast.revision())
  first.state.revision = 6
  seen.push(cast.revision())
  current = null
  seen.push(cast.revision())
  const second = session(0)
  current = second.session
  seen.push(cast.revision())
  second.state.revision = 2
  seen.push(cast.revision())
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] >= seen[k - 1], `${seen}`)
  assert.equal(new Set(seen.slice(2, 4)).size, 2, 'a session that ended is no session still')
  assert.ok(seen[4] > seen[2], 'a new session at revision 0 is not taken for the one before at 6')
  assert.equal(cast.revision(), seen[5], 'a read moves nothing')
})

test('a cast stops at the bodies of every object type, through the body it names', () => {
  const { session: s, asked } = session()
  const cast = createViewOriginCast(() => s)
  cast.post([1, 2, 3], [0, 0, -1], 50, body, () => {})
  const [query] = asked
  assert.equal(query[CAST_AT.stop], CAST_STOP.objectTypes)
  assert.deepEqual(
    [query[CAST_AT.objectTypes], query[CAST_AT.objectTypes + 1]],
    [...objectTypeWords(COLLISION_CHANNELS)],
  )
  assert.equal(query[CAST_AT.ignored], 3)
  cast.post([1, 2, 3], [0, 0, -1], 50, undefined, () => {})
  assert.equal(asked[1][CAST_AT.ignored], NO_INDEX, 'no body: none passed through')
})

test('a world whose physics is off answers a miss at once', () => {
  const cast = createViewOriginCast(() => null)
  let answered: Uint32Array | undefined
  cast.post([0, 0, 0], [0, 0, -1], 10, undefined, (hit) => (answered = hit))
  assert.ok(answered)
  assert.equal(rayHitDistance(answered, 10), null)
})

test('a hit is the fraction of the reach it lies at; a miss names no body', () => {
  const hit = new Uint32Array(HIT_WORDS)
  hit[HIT_AT.body] = 1
  new Float32Array(hit.buffer)[HIT_AT.fraction] = 0.25
  assert.equal(rayHitDistance(hit, 40), 10)
  hit[HIT_AT.body] = NO_INDEX
  assert.equal(rayHitDistance(hit, 40), null)
})

test('the epoch moves when the session does, though no read saw the physics off between two sessions', () => {
  let current: PhysicsSession | null = null
  const cast = createViewOriginCast(() => current)
  const none = cast.epoch()
  assert.equal(cast.epoch(), none, 'a read moves nothing')
  const first = session()
  current = first.session
  const one = cast.epoch()
  assert.notEqual(one, none)
  assert.equal(cast.epoch(), one, 'the session stands')
  first.state.revision = 4
  assert.equal(cast.epoch(), one, 'its world moving is no new session')
  current = session().session
  assert.notEqual(cast.epoch(), one, 'another session in its place')
  current = null
  const ended = cast.epoch()
  assert.equal(cast.epoch(), ended)
})

test('a post goes to the session now, and a cast of an earlier epoch is of the one before', () => {
  let current: PhysicsSession | null = null
  const cast = createViewOriginCast(() => current)
  const first = session(),
    second = session()
  current = first.session
  cast.post([0, 0, 0], [0, 0, -1], 10, undefined, () => {})
  const epoch = cast.epoch()
  current = second.session
  cast.post([0, 0, 0], [0, 0, -1], 10, undefined, () => {})
  assert.deepEqual([first.asked.length, second.asked.length], [1, 1])
  assert.notEqual(cast.epoch(), epoch)
})
