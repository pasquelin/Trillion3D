import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSceneLight } from './validate.ts'
import { writeLightFields, LIGHT_FIELD } from './fields.ts'
import { sameSceneLight } from './equal.ts'
import { cloneSceneLight } from './clone.ts'
import type { SceneLight } from './contracts.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'

const source: SceneLight = {
  id: 'disk',
  kind: 'directional',
  color: [1, 1, 1],
  intensity: 1,
  direction: [0, -1, 0],
  castsShadow: true,
}
test('directional source angle is validated, copied and packed in radians', () => {
  const light = validateSceneLight({ ...source, angularRadius: 0.01 })
  const copy = cloneSceneLight(light)
  assert.equal(copy.angularRadius, 0.01)
  const packed = new Float32Array(20)
  writeLightFields(packed, 0, copy)
  assert.equal(packed[LIGHT_FIELD.angularRadius], Math.fround(0.01))
  assert.equal(sameSceneLight(source, light), false)
  assert.equal(validateSceneLight({ ...source, angularRadius: 0 }).angularRadius, 0)
  for (const angle of [-1, NaN, Infinity, HALF_PI])
    assert.throws(() => validateSceneLight({ ...source, angularRadius: angle }), /angularRadius/)
  assert.throws(
    () =>
      validateSceneLight({
        ...source,
        kind: 'point',
        angularRadius: 0.01,
        position: [0, 0, 0],
        range: 10,
      }),
    /angularRadius/,
  )
})
