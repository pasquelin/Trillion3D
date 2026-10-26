import test from 'node:test'
import assert from 'node:assert/strict'
import { Light } from './light.ts'
import { lampRecord, lightFromRecord } from './lightRecord.ts'
import { validateSceneLight } from '../../scene/light/validate.ts'
import { mobilityOf } from '../../scene/light/fields.ts'
import type { SceneLight } from '../../scene/light/contracts.ts'

// The mobility of a light: stationary by default, as every light actor of the reference.
const lamp = (mobility?: Light['mobility']) =>
  lampRecord(new Light('point', { intensity: 3, position: [1, 2, 3], mobility }), 'p', () => 40)!

test('every light kind is stationary unless a page says otherwise', () => {
  for (const kind of ['point', 'spot', 'directional', 'rectArea'])
    assert.equal(new Light(kind).mobility, 'stationary', kind)
})

test('a write is kept, copied and recorded only against the default', () => {
  const light = new Light('point', { intensity: 3, mobility: 'movable' })
  assert.equal(light.mobility, 'movable')
  assert.equal(new Light('point').copy(light).mobility, 'movable')
  light.mobility = 'static'
  assert.equal(light.mobility, 'static')
  assert.equal(lamp().mobility, undefined, 'the default is not recorded')
  assert.equal(lamp('static').mobility, 'static')
  assert.equal(lightFromRecord(lamp('movable')).mobility, 'movable')
})

test('a mobility that is none of the three is refused', () => {
  assert.throws(() => (new Light('point').mobility = 'fixed' as never), {
    code: 'INVALID_SCENE_LIGHT',
  })
  const light: SceneLight = { ...lamp(), mobility: 'fixed' as never }
  assert.throws(() => validateSceneLight(light), { code: 'INVALID_SCENE_LIGHT' })
  assert.equal(mobilityOf(lamp()), 'stationary')
  assert.equal(validateSceneLight({ ...lamp(), mobility: 'static' }).mobility, 'static')
})
