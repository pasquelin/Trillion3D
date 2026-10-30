// The toon profile (`profile.ts`) and the row the light buffer holds it as (`rows.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromHalf } from '../../../../math/src/float/half.ts'
import { resolveToonProfile, sampleToonRamps } from './profile.ts'
import {
  TOON_PARAM,
  TOON_PROFILE_RESOLUTION,
  packToonRow,
  toonLayout,
  toonShadowExtinction,
  toonResolutionOf,
} from './rows.ts'

const layout = toonLayout(TOON_PROFILE_RESOLUTION)
const TOON_RAMP_TEXELS = layout.texels
const TOON_ROW = layout.row

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`)

test('a profile that gives nothing is the default: four diffuse bands, a hard specular, a shadow with no hatching', () => {
  const p = resolveToonProfile({})
  assert.equal(p.diffuseRamp.length, 9)
  assert.equal(p.shadowHatchingPatternSize, 1)
  assert.equal(p.diffuseRampOffsetTexture, null)
  assert.equal(p.diffuseRampOffsetStrength, 0)
  assert.equal(p.shadowHatchingPatternStrength, 1)
  assert.equal(p.diffuseRampIncludesShadow, false)
})

test('the default diffuse ramp is flat between its steps and rises linearly across them', () => {
  const { diffuse } = sampleToonRamps(resolveToonProfile({}), 1000)
  // Texel i is read at (i + 0.5) / 1000.
  near(diffuse[100 * 3], 0)
  near(diffuse[255 * 3], 0.1375)
  near(diffuse[400 * 3 + 1], 0.25)
  near(diffuse[900 * 3 + 2], 0.75)
  near(diffuse[999 * 3], 0.9875)
})

test('a ramp holds its first key’s value before it and its last key’s after it', () => {
  const { diffuse } = sampleToonRamps(
    resolveToonProfile({
      diffuseRamp: [
        [0.2, 0.5],
        [0.8, 1],
      ],
    }),
    100,
  )
  near(diffuse[0], 0.5)
  near(diffuse[99 * 3], 1)
  near(diffuse[50 * 3], 0.5 + (0.5 * (0.505 - 0.2)) / 0.6)
})

test('a field of another kind or out of range is held to the default or its range', () => {
  const p = resolveToonProfile({
    shadowHatchingPatternSize: 500,
    diffuseRampOffsetSize: 0.2,
    diffuseRampOffsetStrength: -3,
    specularRamp: [[0, 'x' as unknown as number]],
    diffuseRampIncludesShadow: 'yes' as unknown as boolean,
    shadowHatchingPatternTexture: {} as never,
  })
  assert.equal(p.shadowHatchingPatternSize, 500)
  assert.equal(p.diffuseRampOffsetSize, 1)
  assert.equal(p.diffuseRampOffsetStrength, 0)
  assert.equal(p.specularRamp.length, 4)
  assert.equal(p.diffuseRampIncludesShadow, false)
  assert.equal(p.shadowHatchingPatternTexture, null)
})

test('a ramp of colour keys is sorted by time and read per channel; a curve reads its keys', () => {
  const { diffuse, shadow } = sampleToonRamps(
    resolveToonProfile({
      diffuseRamp: [
        [1, [1, 0, 0]],
        [0, [0, 0, 1]],
      ],
      shadowHatchingPatternDistributionRamp: [
        [0, 0.5],
        [1, 1],
      ],
    }),
    2,
  )
  near(diffuse[0], 0.25)
  near(diffuse[2], 0.75)
  near(diffuse[3], 0.75)
  near(diffuse[5], 0.25)
  near(shadow[0], 0.625)
  near(shadow[1], 0.875)
})

test('the ramps are sampled at the centres of the texels', () => {
  const { diffuse, specular, shadow } = sampleToonRamps(resolveToonProfile({}), TOON_RAMP_TEXELS)
  near(diffuse[0], 0)
  near(diffuse[(TOON_RAMP_TEXELS - 1) * 3], 0.75 + (0.25 * (1 - 0.5 / 64 - 0.99)) / 0.01)
  near(specular[10 * 3], 0)
  near(specular[40 * 3], 1)
  near(shadow[31], 31.5 / 64)
})

test('the row holds the ramps as half floats and the parameters, an image’s strength zero where it has none', () => {
  const profile = resolveToonProfile({
    diffuseRampOffsetStrength: 0.5,
    shadowHatchingPatternStrength: 0.7,
    diffuseIndirectScale: 0.25,
    diffuseRampIncludesShadow: true,
  })
  const row = packToonRow(profile, -1, layout)
  assert.equal(row.length, layout.rowWords)
  const floats = new Float32Array(row.buffer)
  const p = TOON_ROW.params
  assert.equal(floats[p + TOON_PARAM.diffuseOffsetStrength], 0)
  assert.equal(floats[p + TOON_PARAM.shadowHatchStrength], 0)
  assert.equal(floats[p + TOON_PARAM.diffuseIndirectScale], 0.25)
  assert.equal(floats[p + TOON_PARAM.rampIncludesShadow], 1)
  assert.equal(row[p + TOON_PARAM.patternSlot], 0)
  near(floats[p + TOON_PARAM.shadowHatchSize], 1)
  near(fromHalf(row[TOON_ROW.specular + 40 * 2]! & 0xffff), 1, 1e-3)
  near(fromHalf(row[TOON_ROW.shadow + 15]! >>> 16), 31.5 / 64, 1e-3)
  assert.equal(packToonRow(profile, 3, layout)[p + TOON_PARAM.patternSlot], 4)
})

test('the shadow extinction (per metre, to 100) is given per centimetre, and the specular indirect settings are packed with their ramp', () => {
  const none = resolveToonProfile({})
  assert.equal(none.shadowExtinctionCoefficient, 10)
  assert.equal(none.specularIndirectScale, 1)
  assert.equal(none.specularIndirectRampRepetition, 0)
  assert.equal(
    resolveToonProfile({ shadowExtinctionCoefficient: 500 }).shadowExtinctionCoefficient,
    100,
  )
  const profile = resolveToonProfile({
    shadowExtinctionCoefficient: 50,
    specularIndirectScale: 0.4,
    specularIndirectRampRepetition: 3,
    specularIndirectRamp: [
      [0, 1],
      [1, 0],
    ],
  })
  const row = packToonRow(profile, -1, layout)
  const floats = new Float32Array(row.buffer)
  const p = TOON_ROW.params
  near(toonShadowExtinction(profile), 0.5)
  near(floats[p + TOON_PARAM.specularIndirectScale], 0.4)
  near(floats[p + TOON_PARAM.specularIndirectRampRepetition], 3)
  near(fromHalf(row[TOON_ROW.specularIndirect + 15]! >>> 16), 1 - 31.5 / 64, 1e-3)
})

test('the resolution is held to 64 and to a multiple of 8, and the layout of a row and of a pattern follows it', () => {
  assert.equal(toonResolutionOf(10), 64)
  assert.equal(toonResolutionOf(65), 72)
  assert.equal(toonResolutionOf(128), 128)
  const wide = toonLayout(128)
  assert.equal(wide.row.params, 640)
  assert.equal(wide.rowWords, 640 + TOON_PARAM.length)
  assert.equal(wide.patternWords, 2 * 128 * 128)
  assert.equal(packToonRow(resolveToonProfile({}), -1, wide).length, wide.rowWords)
})
