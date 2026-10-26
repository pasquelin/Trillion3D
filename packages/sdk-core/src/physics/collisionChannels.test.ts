import test from 'node:test'
import assert from 'node:assert/strict'
import {
  channelIndex,
  channelMask,
  channelsMeet,
  COLLISION_CHANNELS,
  COLLISION_PROFILES,
  defaultProfile,
  filterKey,
  resolveCollision,
} from './collisionChannels.ts'

test('there are 64 channels: the engine eight, six reserved, fifty the game names', () => {
  assert.equal(COLLISION_CHANNELS.length, 64)
  assert.equal(channelIndex('worldStatic'), 0)
  assert.equal(channelIndex('destructible'), 7)
  assert.equal(channelIndex('engineTrace1'), 8)
  assert.equal(channelIndex('gameTrace1'), 14)
  assert.equal(channelIndex('gameTrace50'), 63)
  assert.equal(channelIndex(20), 20)
  assert.throws(() => channelIndex(64), /COLLISION_CHANNEL|does not exist/)
  assert.throws(() => channelIndex('nope' as never), /does not exist/)
})

test('a profile blocks every channel it does not name', () => {
  const blockAll = resolveCollision({ profile: 'BlockAll' }, 'BlockAll')
  assert.equal(blockAll.block, (1n << 64n) - 1n)
  assert.equal(blockAll.overlap, 0n)
  assert.equal(blockAll.objectType, 0)
  assert.deepEqual([blockAll.query, blockAll.physics], [true, true])
  const pawn = resolveCollision({ profile: 'Pawn' }, 'BlockAll')
  assert.equal(pawn.objectType, channelIndex('pawn'))
  assert.equal(pawn.block & (1n << BigInt(channelIndex('visibility'))), 0n)
})

test('overlapAll overlaps the eight engine channels and blocks the rest, on queries alone', () => {
  const all = resolveCollision({ profile: 'OverlapAll' }, 'BlockAll')
  assert.equal(all.overlap, channelMask(COLLISION_CHANNELS.slice(0, 8)))
  assert.equal(all.block, ((1n << 64n) - 1n) ^ all.overlap)
  assert.deepEqual([all.query, all.physics], [true, false])
})

test('responses, object type and enabled override the profile, by name or by number', () => {
  const body = resolveCollision(
    {
      profile: 'PhysicsActor',
      objectType: 'gameTrace3',
      responses: { pawn: 'ignore', 30: 'overlap' },
      enabled: 'physicsOnly',
    },
    'BlockAll',
  )
  assert.equal(body.objectType, 16)
  assert.equal(body.block & (1n << 2n), 0n)
  assert.equal(body.overlap, 1n << 30n)
  assert.deepEqual([body.query, body.physics], [false, true])
  assert.throws(
    () => resolveCollision({ responses: { pawn: 'stop' as never } }, 'BlockAll'),
    /does not exist/,
  )
  assert.throws(() => resolveCollision({ profile: 'Nope' as never }, 'BlockAll'), /Nope/)
})

test('two bodies meet by the lesser of what each answers to the other', () => {
  const stone = resolveCollision(undefined, 'BlockAll')
  const crate = resolveCollision(undefined, 'PhysicsActor')
  const trigger = resolveCollision({ profile: 'Trigger' }, 'BlockAll')
  const ghost = resolveCollision(
    { profile: 'PhysicsActor', responses: { worldStatic: 'ignore' } },
    'BlockAll',
  )
  assert.equal(channelsMeet(stone, crate), 'block')
  assert.equal(channelsMeet(crate, crate), 'block')
  assert.equal(channelsMeet(trigger, crate), 'overlap')
  assert.equal(channelsMeet(crate, trigger), 'overlap')
  assert.equal(channelsMeet(ghost, stone), 'ignore')
  assert.equal(channelsMeet(stone, ghost), 'ignore')
})

test('a body names its profile by its motion: static blocks all, dynamic is a physics actor', () => {
  assert.equal(defaultProfile('static'), 'BlockAll')
  assert.equal(defaultProfile('dynamic'), 'PhysicsActor')
  assert.equal(defaultProfile('kinematic'), 'BlockAllDynamic')
  assert.equal(defaultProfile('dynamic', true), 'OverlapAllDynamic')
  assert.ok(Object.keys(COLLISION_PROFILES).includes('Trigger'))
})

test('two collisions of one filter share a key, a static one and a moving one do not', () => {
  const a = resolveCollision(undefined, 'PhysicsActor')
  assert.equal(
    filterKey(a, false),
    filterKey(resolveCollision({ profile: 'PhysicsActor' }, 'BlockAll'), false),
  )
  assert.notEqual(filterKey(a, false), filterKey(a, true))
})
