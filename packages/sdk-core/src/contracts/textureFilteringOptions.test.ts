// The texture filtering's two ceilings: the values of each quality level are the reference's texture
// quality rows (sampler ceiling 1/2/4/8/8, streamed textures' 4/4/8/8/8), the top and cinematic
// levels write nothing, the resolver takes whole numbers from 1 to 16 only, and a streamed
// texture's ceiling is a power of two.
import test from 'node:test'
import assert from 'node:assert/strict'
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../runtime/qualityLevels.ts'
import { resolveSetting, resolveSettings } from './settingRules.ts'
import { streamedAnisotropyCeiling, TEXTURE_FILTERING_RULES } from './textureFilteringOptions.ts'

/** The ceilings a level resolves to over the defaults. */
const ceilings = (level: (typeof QUALITY_PRESETS)[number]) =>
  resolveSettings(TEXTURE_FILTERING_RULES, QUALITY_LEVELS.textures[level] as never)

test('the defaults are the top texture quality row, 8 and 8', () => {
  assert.deepEqual(resolveSettings(TEXTURE_FILTERING_RULES, {}), {
    textureMaxAnisotropy: 8,
    virtualTextureMaxAnisotropy: 8,
    virtualTextureAnisotropicFiltering: false,
  })
})

test('the taps are off at every quality level: the reference holds one value of it', () => {
  for (const level of QUALITY_PRESETS)
    assert.equal(ceilings(level).virtualTextureAnisotropicFiltering, false, level)
  assert.equal(
    resolveSetting(TEXTURE_FILTERING_RULES.virtualTextureAnisotropicFiltering, true),
    true,
  )
  assert.throws(
    () => resolveSetting(TEXTURE_FILTERING_RULES.virtualTextureAnisotropicFiltering, 1 as never),
    TypeError,
  )
})

test('each quality level writes the reference row of its own: smooth, balanced, fine, max, cinematic', () => {
  const rows = [
    [1, 4],
    [2, 4],
    [4, 8],
    [8, 8],
    [8, 8],
  ]
  QUALITY_PRESETS.forEach((level, at) => {
    const { textureMaxAnisotropy, virtualTextureMaxAnisotropy } = ceilings(level)
    assert.deepEqual([textureMaxAnisotropy, virtualTextureMaxAnisotropy], rows[at], level)
  })
  assert.deepEqual(QUALITY_LEVELS.textures.max, {}, 'the top level writes nothing')
  assert.deepEqual(QUALITY_LEVELS.textures.cinematic, {}, 'nor the cinematic one: the same row')
})

test('a ceiling takes the whole numbers from 1 to 16 and refuses the others', () => {
  for (const rule of Object.values(TEXTURE_FILTERING_RULES).filter((rule) => rule.kind === 'int')) {
    assert.equal(resolveSetting(rule, 1), 1)
    assert.equal(resolveSetting(rule, 16), 16)
    assert.equal(resolveSetting(rule, undefined), 8)
    assert.throws(() => resolveSetting(rule, 0), TypeError)
    assert.throws(() => resolveSetting(rule, 17), TypeError)
    assert.throws(() => resolveSetting(rule, 2.5), TypeError)
  }
})

test('a streamed texture’s ceiling is the power of two at or below the setting', () => {
  const held = [1, 2, 3, 4, 5, 7, 8, 12, 16].map(streamedAnisotropyCeiling)
  assert.deepEqual(held, [1, 2, 2, 4, 4, 4, 8, 8, 16])
})
