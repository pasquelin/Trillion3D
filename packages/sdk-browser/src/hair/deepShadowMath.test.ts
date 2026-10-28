// The deep shadows' numbers: the layers' depths and which lights reach a group.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import { boxSphereOf } from './boxSphere.ts'
import { deepShadowLayerDepths, deepShadowLights, deepShadowReaches } from './deepShadowMath.ts'

test('the layers lie at the fifths of the range raised to an exponent that grows with the distribution', () => {
  const even = deepShadowLayerDepths(0)
  assert.deepEqual(
    even.map((d) => Math.round(d * 10) / 10),
    [0.2, 0.4, 0.6, 0.8],
  )
  const middle = deepShadowLayerDepths(0.5)
  assert.ok(Math.abs(middle[3] - 0.8 ** 3.6) < 1e-12, 'the default exponent is 3.6')
  assert.ok(deepShadowLayerDepths(1)[3] < middle[3], 'layers gather near the front')
  assert.deepEqual(deepShadowLayerDepths(7), deepShadowLayerDepths(1), 'held to 0 to 1')
})

test('only a light that casts a hair deep shadow draws one, and a local light reaches the groups in its range', () => {
  const base = { id: 'a', color: [1, 1, 1], castsShadow: true } as const
  const lights = [
    { light: { ...base, kind: 'directional', direction: [0, -1, 0] } },
    { light: { ...base, kind: 'directional', direction: [0, -1, 0], castHairDeepShadow: true } },
    {
      light: { ...base, kind: 'point', position: [10, 0, 0], range: 5, castHairDeepShadow: true },
    },
  ] as unknown as { light: SceneLight }[]
  const found = deepShadowLights(lights, [4, 0, 0])
  // A local light is placed in the camera's translated world; a directional one keeps its way.
  assert.deepEqual(found[1]!.vector, [6, 0, 0])
  assert.deepEqual(found[0]!.vector, [0, -1, 0])
  assert.equal(found.length, 2)
  assert.deepEqual(
    found.map((light) => light.directional),
    [true, false],
  )
  assert.equal(found[0]!.layerDistribution, 0.5)
  const near = boxSphereOf([4, -1, -1, 5, 1, 1])
  const far = boxSphereOf([-13, -1, -1, -12, 1, 1])
  assert.ok(deepShadowReaches(found[0]!, far), 'a sun reaches all')
  assert.ok(deepShadowReaches(found[1]!, near))
  assert.ok(!deepShadowReaches(found[1]!, far))
})
