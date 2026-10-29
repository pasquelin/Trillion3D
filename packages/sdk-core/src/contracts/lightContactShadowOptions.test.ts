// A light's contact shadows and its indirect lighting factor: no ray, whole shadow at a surface that
// casts and none at one that does not, a factor of 1 on its indirect light — each refused outside what
// its rule takes, in words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLightContactShadow } from './lightContactShadowOptions.ts'

test('a light casts no contact shadow by default, and the shadow it casts is whole at a surface that casts', () => {
  assert.deepEqual(resolveLightContactShadow({}), {
    contactShadowLength: 0,
    contactShadowLengthInWorldSpace: false,
    contactShadowCastingIntensity: 1,
    contactShadowNonCastingIntensity: 0,
    indirectLightingIntensity: 1,
    castRayTracedShadow: 'useProjectSetting',
    rayTracedShadowSamplesPerPixel: 1,
  })
  assert.equal(resolveLightContactShadow({ contactShadowLength: 0.02 }).contactShadowLength, 0.02)
  assert.equal(
    resolveLightContactShadow({ contactShadowLengthInWorldSpace: true })
      .contactShadowLengthInWorldSpace,
    true,
  )
})

test('a negative length, an intensity outside 0 to 1 and a negative indirect factor are refused', () => {
  const refuses = (given: Record<string, unknown>, words: RegExp) =>
    assert.throws(() => resolveLightContactShadow(given), words, JSON.stringify(given))
  refuses({ contactShadowLength: -0.01 }, /at least 0/)
  refuses({ contactShadowLength: NaN }, /at least 0/)
  refuses({ contactShadowCastingIntensity: 1.5 }, /from 0 to 1/)
  refuses({ contactShadowNonCastingIntensity: -0.1 }, /from 0 to 1/)
  refuses({ indirectLightingIntensity: -1 }, /at least 0/)
  refuses({ contactShadowLengthInWorldSpace: 1 }, /true or false/)
  refuses({ contactShadowLenght: 1 }, /no field contactShadowLenght/)
  assert.equal(
    resolveLightContactShadow({ indirectLightingIntensity: 0 }).indirectLightingIntensity,
    0,
  )
})

test('a light follows the view for its ray traced shadow, casts one ray a pixel, and refuses a choice or a count it does not take', () => {
  assert.equal(
    resolveLightContactShadow({ castRayTracedShadow: 'enabled' }).castRayTracedShadow,
    'enabled',
  )
  assert.equal(
    resolveLightContactShadow({ rayTracedShadowSamplesPerPixel: 4 }).rayTracedShadowSamplesPerPixel,
    4,
  )
  assert.throws(
    () => resolveLightContactShadow({ castRayTracedShadow: 'always' }),
    /castRayTracedShadow/,
  )
  assert.throws(
    () => resolveLightContactShadow({ rayTracedShadowSamplesPerPixel: 0 }),
    /rayTracedShadowSamplesPerPixel/,
  )
})
