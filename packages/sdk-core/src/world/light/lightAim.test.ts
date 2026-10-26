import test from 'node:test'
import assert from 'node:assert/strict'
import { light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'
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

test('a spot opens a cone narrower than a half-space, and casts shadows unless told not to', () => {
  const spot = light.spot()
  assert.ok(spot.outerConeAngle > 0 && spot.outerConeAngle < HALF_PI)
  assert.equal(spot.castShadow, true)
  assert.equal(light.spot({ castShadow: false }).castShadow, false)
})

test('a lamp fades its cone whole, falls off as the inverse square and gives all its light, until it says otherwise', () => {
  const settings = (lamp: ReturnType<typeof light.spot>) => [
    lamp.innerConeAngle,
    lamp.inverseSquared,
    lamp.radialExponent,
    lamp.diffuseShare,
    lamp.specularShare,
  ]
  const spot = light.spot({ castShadow: true })
  assert.deepEqual(settings(spot), [0, true, 8, 1, 1])
  const plain = lampRecord(spot, 's', () => 9)!
  for (const key of ['innerConeAngle', 'inverseSquared', 'radialExponent', 'diffuseShare'] as const)
    assert.equal(key in plain, false, `${key}: the default stays out of the record`)
  const own = light.spot({
    ...{ innerConeAngle: 0.25, inverseSquared: false, radialExponent: 3 },
    ...{ diffuseShare: 0.5, specularShare: 0.25 },
  })
  const record = lampRecord(own, 's', () => 9)!
  assert.deepEqual(
    [record.innerConeAngle, record.inverseSquared, record.radialExponent],
    [0.25, false, 3],
  )
  assert.deepEqual([record.diffuseShare, record.specularShare], [0.5, 0.25])
  assert.deepEqual(settings(lightFromRecord(record)), settings(own), 'a record builds it again')
  assert.deepEqual(settings(light.spot().copy(own)), settings(own), 'a copy keeps them')
  own.inverseSquared = true
  assert.equal('inverseSquared' in lampRecord(own, 's', () => 9)!, false, 'back to the default')
})
