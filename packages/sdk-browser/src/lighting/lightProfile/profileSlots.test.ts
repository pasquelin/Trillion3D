// The places of the light profiles in the atlas: one a distinct profile, found by its id and counted by
// the lights that name it, the slices handed out first-freed first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProfileSlots } from './profileSlots.ts'
import type { LightProfileData } from './profileCodec.ts'

const data = (): LightProfileData => ({
  texels: new Uint16Array(4),
})

test('a profile named by two lights holds one slot, freed with the last', () => {
  const slots = createProfileSlots(32)
  slots.add('a', data())
  slots.add('a', data())
  assert.equal(slots.refsOf('a'), 2)
  assert.equal(slots.plan().length, 1, 'written once')
  slots.remove('a')
  assert.equal(slots.refsOf('a'), 1)
  assert.ok(slots.sliceOf('a') >= 0, 'one light still names it')
  slots.remove('a')
  assert.equal(slots.refsOf('a'), 0)
  assert.equal(slots.sliceOf('a'), -1)
})

test('a profile has no slice before it is planned, and the plan gives the free slices in order', () => {
  const slots = createProfileSlots(32)
  slots.add('a', data())
  slots.add('b', data())
  assert.equal(slots.sliceOf('a'), -1)
  const uploads = slots.plan()
  assert.deepEqual(
    uploads.map((u) => u.slice),
    [0, 1],
  )
  assert.equal(slots.sliceOf('a'), 0)
  assert.equal(slots.sliceOf('b'), 1)
  assert.deepEqual(slots.plan(), [], 'nothing new')
})

test('a profile added later takes a freed slice and leaves the others where they are', () => {
  const slots = createProfileSlots(32)
  slots.add('a', data())
  slots.add('b', data())
  slots.plan()
  slots.remove('a')
  slots.add('c', data())
  const uploads = slots.plan()
  assert.deepEqual(
    uploads.map((u) => u.slice),
    [2],
    'the slice freed last is taken after the ones never given',
  )
  assert.equal(slots.sliceOf('b'), 1)
  assert.equal(slots.sliceOf('c'), 2)
})

test('profiles past the atlas’s slices have none, and take the first one freed', () => {
  const slots = createProfileSlots(2)
  for (const id of ['a', 'b', 'c']) slots.add(id, data())
  slots.plan()
  assert.equal(slots.sliceOf('c'), -1)
  slots.remove('a')
  const next = slots.plan()
  assert.deepEqual(
    next.map((u) => u.slice),
    [0],
  )
  assert.equal(slots.sliceOf('c'), 0)
  assert.equal(slots.sliceOf('b'), 1)
})

test('an id that is no profile names no slice and no light', () => {
  const slots = createProfileSlots(32)
  assert.equal(slots.sliceOf('x'), -1)
  assert.equal(slots.refsOf('x'), 0)
  slots.remove('x')
})
