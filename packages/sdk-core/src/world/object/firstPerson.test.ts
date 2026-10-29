import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from './index.ts'
import { geometry } from '../geometry/index.ts'

// The two first-person switches of an object (`Object3D.firstPerson`,
// `Object3D.firstPersonWorldSpaceRepresentation`): off by default, never both, copied with the node.
test('both switches are off by default and a node is one or the other', () => {
  const arms = object.mesh(geometry.box(1, 1, 1))
  assert.deepEqual([arms.firstPerson, arms.firstPersonWorldSpaceRepresentation], [false, false])
  arms.firstPerson = true
  assert.throws(() => (arms.firstPersonWorldSpaceRepresentation = true), RangeError)
  arms.firstPerson = false
  arms.firstPersonWorldSpaceRepresentation = true
  assert.throws(() => (arms.firstPerson = true), RangeError)
})

test('a copy takes the switches, the one turned off first', () => {
  const body = object.mesh(geometry.box(1, 1, 1))
  body.firstPersonWorldSpaceRepresentation = true
  const other = object.mesh(geometry.box(1, 1, 1))
  other.firstPerson = true
  other.copy(body)
  assert.deepEqual([other.firstPerson, other.firstPersonWorldSpaceRepresentation], [false, true])
})

// The switch that lets the contact shadow rays through an object (`Object3D.castContactShadow`).
test('the contact shadow switch is on by default, a boolean, and copied with the node', () => {
  const wall = object.mesh(geometry.box(1, 1, 1))
  assert.equal(wall.castContactShadow, true)
  assert.throws(() => (wall.castContactShadow = 0 as never), RangeError)
  assert.equal(wall.castContactShadow, true, 'a refused write changes nothing')
  wall.castContactShadow = false
  const other = object.mesh(geometry.box(1, 1, 1))
  other.copy(wall)
  assert.equal(other.castContactShadow, false)
  other.copy(object.mesh(geometry.box(1, 1, 1)))
  assert.equal(other.castContactShadow, true, 'a copy of a default node is on again')
})

// The switch that takes an object out of the distance fields' scene (`Object3D.affectDistanceFieldLighting`).
test('the distance-field switch is on by default, a boolean, and copied with the node', () => {
  const wall = object.mesh(geometry.box(1, 1, 1))
  assert.equal(wall.affectDistanceFieldLighting, true)
  assert.throws(() => (wall.affectDistanceFieldLighting = 0 as never), RangeError)
  assert.equal(wall.affectDistanceFieldLighting, true, 'a refused write changes nothing')
  wall.affectDistanceFieldLighting = false
  const other = object.mesh(geometry.box(1, 1, 1))
  other.copy(wall)
  assert.equal(other.affectDistanceFieldLighting, false)
  other.copy(object.mesh(geometry.box(1, 1, 1)))
  assert.equal(other.affectDistanceFieldLighting, true, 'a copy of a default node is on again')
})

// The switch beside them that holds an object out of the image's alpha (`Object3D.holdout`).
test('the holdout switch is off by default, a boolean, and copied with the node', () => {
  const wall = object.mesh(geometry.box(1, 1, 1))
  assert.equal(wall.holdout, false)
  assert.throws(() => (wall.holdout = 1 as never), RangeError)
  wall.holdout = true
  const other = object.mesh(geometry.box(1, 1, 1))
  other.copy(wall)
  assert.equal(other.holdout, true)
  other.copy(object.mesh(geometry.box(1, 1, 1)))
  assert.equal(other.holdout, false)
})
