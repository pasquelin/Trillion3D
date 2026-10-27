// The ambient cubemap's options (`ambientCubemapOptions.ts`): off by default, the tint and the intensity white and one, the cube
// checked as the sky light's is, the pass drawn only for a cube whose colour is not black.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AMBIENT_CUBEMAP_RULES,
  ambientCubemapColour,
  isAmbientCubemapActive,
  resolveAmbientCubemap,
} from './ambientCubemapOptions.ts'
import { AMBIENT_CUBEMAP_MEANINGS } from '../llm/ambientCubemapMeanings.ts'
import { ruleProperties } from '../llm/settingProperties.ts'

/** A cube of `size` texels a face, every texel `value`. */
const cube = (size: number, value = 0.5) => ({
  size,
  texels: new Float32Array(6 * size * size * 3).fill(value),
})

test('nothing written is no cube, a white tint and an intensity of one', () => {
  const ambient = resolveAmbientCubemap()
  assert.equal(ambient.ambientCubemap, undefined)
  assert.deepEqual(
    [
      ambient.ambientCubemapTintRed,
      ambient.ambientCubemapTintGreen,
      ambient.ambientCubemapTintBlue,
    ],
    [1, 1, 1],
  )
  assert.equal(ambient.ambientCubemapIntensity, 1)
  assert.equal(isAmbientCubemapActive(ambient), false)
  assert.equal(resolveAmbientCubemap({ ambientCubemap: null }).ambientCubemap, undefined)
})

test('the colour of the light is the tint times the intensity', () => {
  const ambient = resolveAmbientCubemap({
    ambientCubemapTintRed: 0.5,
    ambientCubemapTintGreen: 1,
    ambientCubemapTintBlue: 2,
    ambientCubemapIntensity: 3,
  })
  assert.deepEqual(ambientCubemapColour(ambient), [1.5, 3, 6])
})

test('a cube is drawn unless its colour is black', () => {
  const data = cube(16)
  assert.equal(isAmbientCubemapActive(resolveAmbientCubemap({ ambientCubemap: data })), true)
  assert.equal(
    isAmbientCubemapActive(
      resolveAmbientCubemap({ ambientCubemap: data, ambientCubemapIntensity: 0 }),
    ),
    false,
  )
  const black = { ambientCubemapTintRed: 0, ambientCubemapTintGreen: 0, ambientCubemapTintBlue: 0 }
  assert.equal(
    isAmbientCubemapActive(resolveAmbientCubemap({ ambientCubemap: data, ...black })),
    false,
  )
  // One channel is enough, and a channel under 0.00316 squares under the threshold with the others at zero.
  assert.equal(
    isAmbientCubemapActive(
      resolveAmbientCubemap({ ambientCubemap: data, ...black, ambientCubemapTintGreen: 0.01 }),
    ),
    true,
  )
  assert.equal(
    isAmbientCubemapActive(
      resolveAmbientCubemap({ ambientCubemap: data, ...black, ambientCubemapTintGreen: 0.003 }),
    ),
    false,
  )
})

test('the options are refused naming the field when they are out of their range', () => {
  assert.throws(
    () => resolveAmbientCubemap({ ambientCubemapIntensity: -1 }),
    /ambientCubemapIntensity/,
  )
  assert.throws(
    () => resolveAmbientCubemap({ ambientCubemapTintRed: -0.1 }),
    /ambientCubemapTintRed/,
  )
  assert.throws(
    () => resolveAmbientCubemap({ ambientCubemapTintBlue: Number.NaN }),
    /ambientCubemapTintBlue/,
  )
  assert.throws(
    () => resolveAmbientCubemap({ ambientCubemap: { size: 16, texels: new Float32Array(5) } }),
    /ambientCubemap/,
  )
  const negative = cube(16)
  negative.texels[7] = -1
  assert.throws(() => resolveAmbientCubemap({ ambientCubemap: negative }), /ambientCubemap/)
  // A side that is no power of two, or under 16, has no mip chain to build.
  assert.throws(
    () => resolveAmbientCubemap({ ambientCubemap: cube(24) }),
    /power of two of at least 16/,
  )
  assert.throws(
    () => resolveAmbientCubemap({ ambientCubemap: cube(8) }),
    /power of two of at least 16/,
  )
})

test('every setting has a meaning, and the schema holds its default and bound', () => {
  assert.deepEqual(Object.keys(AMBIENT_CUBEMAP_MEANINGS), Object.keys(AMBIENT_CUBEMAP_RULES))
  const properties = ruleProperties(AMBIENT_CUBEMAP_RULES, AMBIENT_CUBEMAP_MEANINGS)
  for (const field of Object.keys(
    AMBIENT_CUBEMAP_RULES,
  ) as (keyof typeof AMBIENT_CUBEMAP_RULES)[]) {
    assert.equal(properties[field].type, 'number')
    assert.equal(properties[field].default, 1)
    assert.equal(properties[field].minimum, 0)
    assert.ok(properties[field].description)
  }
})
