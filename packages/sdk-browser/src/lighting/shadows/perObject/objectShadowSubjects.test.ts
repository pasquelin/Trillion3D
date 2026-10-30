import test from 'node:test'
import assert from 'node:assert/strict'
import { OBJECT_SHADOW_DEFAULTS } from './translucentShadowRules.ts'
import {
  objectShadowSubjects,
  type ObjectShadowLightRecord,
  type ObjectShadowPrimitive,
} from './objectShadowSubjects.ts'

const settings = { ...OBJECT_SHADOW_DEFAULTS, projectEnabled: true }
const view = { origin: [0, 0, 0], screenScale: 1000, projectionScale: [1, 1] as [number, number] }
const frame = { settings, view }
const light: ObjectShadowLightRecord = {
  id: 1,
  light: { kind: 'directional', direction: [0, 0, -1] },
  castTranslucentShadows: true,
  resolutionScale: 1,
}
const prim = (over: Partial<ObjectShadowPrimitive> = {}): ObjectShadowPrimitive => ({
  id: 7,
  bounds: { origin: [1000, 0, 0], extent: [300, 300, 300], radius: 520 },
  hasTranslucent: true,
  ...over,
})

test('a pair is selected only when every condition of the reference holds', () => {
  assert.equal(objectShadowSubjects(frame, [light], [prim()]).length, 1)
  assert.equal(
    objectShadowSubjects({ ...frame, settings: OBJECT_SHADOW_DEFAULTS }, [light], [prim()]).length,
    0,
  )
  assert.equal(
    objectShadowSubjects(frame, [{ ...light, castTranslucentShadows: false }], [prim()]).length,
    0,
  )
  assert.equal(objectShadowSubjects(frame, [light], [prim({ hasTranslucent: false })]).length, 0)
  // A subject names the place of its primitive in the list the table was given.
  const [first] = objectShadowSubjects(frame, [light], [prim({ hasTranslucent: false }), prim()])
  assert.equal(first!.place, 1)
})
