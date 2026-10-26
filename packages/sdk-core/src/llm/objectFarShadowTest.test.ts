import assert from 'node:assert/strict'
import test from 'node:test'
import { FAR_SHADOW_TEST_SETTING, OBJECT_SETTINGS } from '../contracts/compilerAbi.ts'
import { resolveObjectSettings } from '../contracts/objectOptions.ts'
import { job, validate } from './compilerOptionsSchema.fixture.ts'

test('objectSettings names whether a sun’s far-shadow test reaches an object, for the scene and by object, left out when none says', () => {
  const objectSettings = {
    farShadowTest: false,
    objects: [{ match: 'Tower', farShadowTest: true }, { match: 'Lamp' }],
  }
  assert.equal(validate({ ...job, objectSettings }), true)
  assert.equal(validate({ ...job, objectSettings: { farShadowTest: 'yes' } }), false)
  assert.deepEqual(resolveObjectSettings(objectSettings), {
    farShadowTest: false,
    objects: [{ match: { node: 'Tower' }, farShadowTest: true }, { match: { node: 'Lamp' } }],
  })
  // Left out or null: nothing named, the view's rule decides.
  assert.deepEqual(resolveObjectSettings({ farShadowTest: undefined }), {})
  assert.deepEqual(resolveObjectSettings({ farShadowTest: null } as never), {})
  assert.throws(
    () => resolveObjectSettings({ farShadowTest: 1 } as never),
    /farShadowTest must be true or false, got 1/,
  )
  assert.ok((OBJECT_SETTINGS as readonly string[]).includes(FAR_SHADOW_TEST_SETTING))
  assert.equal(FAR_SHADOW_TEST_SETTING, 'farShadowTest')
})
