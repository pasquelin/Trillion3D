import test from 'node:test'
import assert from 'node:assert/strict'
import { light } from './light.ts'
import { Object3D } from '../object/object3d.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'

test('a light aimed by a direction stands above its target until placed; any other where a node starts', () => {
  for (const kind of ['directional', 'spot', 'hemisphere'] as const) {
    const lamp = light[kind]()
    assert.ok(lamp.position.y > lamp.target.position.y, `${kind} shines down`)
    assert.deepEqual([lamp.position.x, lamp.position.z], [0, 0], `${kind} straight down`)
  }
  for (const kind of ['point', 'ambient', 'rectArea', 'probe'] as const)
    assert.deepEqual(light[kind]().position.toArray(), new Object3D().position.toArray(), kind)
})

test('a spot opens a cone narrower than a half-space, and casts shadows only when asked', () => {
  const spot = light.spot()
  assert.ok(spot.angle > 0 && spot.angle < HALF_PI)
  assert.equal(spot.castShadow, false)
  assert.equal(light.spot({ castShadow: true }).castShadow, true)
})
