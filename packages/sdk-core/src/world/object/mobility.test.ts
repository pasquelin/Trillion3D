import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from './index.ts'
import { geometry } from '../geometry/index.ts'
import { Light } from '../light/light.ts'

// The object's `mobility` (`Object3D.mobility`): whether it is often moving, which the shadows read to
// cache it as dynamic from the frame it joins the scene. Unset by default.
test('mobility is unset by default, one of three values, and refuses any other', () => {
  const crate = object.mesh(geometry.box(1, 1, 1))
  assert.equal(crate.mobility, undefined)
  for (const value of ['static', 'stationary', 'movable'] as const) {
    crate.mobility = value
    assert.equal(crate.mobility, value)
  }
  assert.throws(() => (crate.mobility = 'fixed' as never), RangeError)
  assert.throws(() => (crate.mobility = true as never), RangeError)
  assert.equal(crate.mobility, 'movable', 'a refused value changes nothing')
  crate.mobility = undefined
  assert.equal(crate.mobility, undefined, 'unset gives back the object’s own')
})

test('a copy and a clone take the mobility, a copy of an object that sets none unsets it', () => {
  const crate = object.mesh(geometry.box(1, 1, 1))
  crate.mobility = 'movable'
  const other = object.mesh(geometry.box(1, 1, 1))
  other.copy(crate)
  assert.equal(other.mobility, 'movable')
  assert.equal(object.clone(crate)!.mobility, 'movable')
  other.copy(object.mesh(geometry.box(1, 1, 1)))
  assert.equal(other.mobility, undefined)
})

test('a light keeps its own mobility, and a copy of a light takes its', () => {
  const lamp = new Light('point', { mobility: 'movable' })
  assert.equal(new Light('point').mobility, 'stationary')
  const copy = new Light('point')
  copy.copy(lamp)
  assert.equal(copy.mobility, 'movable')
})
