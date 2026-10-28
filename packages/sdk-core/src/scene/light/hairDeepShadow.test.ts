// The hair deep shadow fields of a light: a switch (off) and the spread of the layers (0.5).
import assert from 'node:assert/strict'
import test from 'node:test'
import type { SceneLight } from './contracts.ts'
import { sameSceneLight } from './equal.ts'
import { validateSceneLight } from './validate.ts'

const sun = (extra: Partial<SceneLight> = {}): SceneLight => ({
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  castsShadow: true,
  ...extra,
})

test('a light that names neither field holds neither, and the two fields are kept when valid', () => {
  const plain = validateSceneLight(sun())
  assert.equal(plain.castHairDeepShadow, undefined)
  assert.equal(plain.hairDeepShadowLayerDistribution, undefined)
  const named = validateSceneLight(
    sun({ castHairDeepShadow: true, hairDeepShadowLayerDistribution: 1 }),
  )
  assert.equal(named.castHairDeepShadow, true)
  assert.equal(named.hairDeepShadowLayerDistribution, 1)
})

test('the switch takes a boolean and the spread a number from 0 to 1', () => {
  assert.throws(
    () => validateSceneLight(sun({ castHairDeepShadow: 1 as never })),
    /castHairDeepShadow expects a boolean/,
  )
  for (const bad of [-0.1, 1.1, NaN, 'x' as never])
    assert.throws(
      () => validateSceneLight(sun({ hairDeepShadowLayerDistribution: bad })),
      /hairDeepShadowLayerDistribution expected in \[0, 1\]/,
    )
})

test('two lights differ by a field and agree by its default', () => {
  const a = validateSceneLight(sun())
  assert.ok(
    sameSceneLight(
      a,
      validateSceneLight(sun({ castHairDeepShadow: false, hairDeepShadowLayerDistribution: 0.5 })),
    ),
  )
  assert.ok(!sameSceneLight(a, validateSceneLight(sun({ castHairDeepShadow: true }))))
  assert.ok(!sameSceneLight(a, validateSceneLight(sun({ hairDeepShadowLayerDistribution: 0.9 }))))
})

test("a sun's classic cascade fields are kept when valid, refused when not, and count as part of the light", () => {
  const plain = validateSceneLight(sun())
  assert.equal(plain.dynamicShadowCascades, undefined)
  const named = validateSceneLight(
    sun({
      dynamicShadowCascades: 3,
      cascadeDistributionExponent: 2,
      cascadeTransitionFraction: 0.2,
      dynamicShadowDistance: 100,
    }),
  )
  assert.equal(named.dynamicShadowCascades, 3)
  assert.equal(named.cascadeDistributionExponent, 2)
  assert.equal(named.cascadeTransitionFraction, 0.2)
  assert.equal(named.dynamicShadowDistance, 100)
  assert.throws(() => validateSceneLight(sun({ dynamicShadowCascades: 2.5 })))
  assert.throws(() => validateSceneLight(sun({ cascadeDistributionExponent: 0.5 })))
  assert.throws(() => validateSceneLight(sun({ cascadeTransitionFraction: 1.5 })))
  assert.equal(validateSceneLight(sun({ shadowBias: 1, shadowSlopeBias: 2 })).shadowSlopeBias, 2)
  assert.throws(() => validateSceneLight(sun({ shadowBias: 5 })))
  assert.ok(sameSceneLight(sun({ shadowBias: 0.5 }), sun()))
  assert.ok(sameSceneLight(sun({ dynamicShadowCascades: 4 }), sun()))
  assert.ok(!sameSceneLight(sun({ dynamicShadowCascades: 2 }), sun()))
})
