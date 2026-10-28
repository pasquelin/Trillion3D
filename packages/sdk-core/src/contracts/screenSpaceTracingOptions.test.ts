import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSetting } from './settingRules.ts'
import {
  SCREEN_SPACE_TRACING_RULES as RULES,
  resolveScreenSpaceMethod,
  screenIndirectOn,
  screenReflectionQualityOf,
  screenReflectionsOn,
  type ScreenSpaceTracingValues,
} from './screenSpaceTracingOptions.ts'

const defaults = () =>
  Object.fromEntries(
    Object.values(RULES).map((rule) => [rule.field, rule.default]),
  ) as unknown as ScreenSpaceTracingValues

test('the defaults are the reference ones: the scene answers, the screen traces are off', () => {
  const values = defaults()
  assert.equal(values.reflectionMethod, 'scene')
  assert.equal(values.globalIlluminationMethod, 'scene')
  assert.equal(values.screenReflectionLevel, 3)
  assert.equal(values.screenReflectionQuality, 50)
  assert.equal(values.screenReflectionIntensity, 100)
  assert.equal(values.screenReflectionMaxRoughness, 0.6)
  assert.equal(values.screenGiLevel, 4)
  assert.equal(values.diffuseIndirectHalfRes, true)
  assert.equal(values.screenReflectionTemporal, false)
  assert.equal(values.screenReflectionTiles, false)
  // The denoiser of the reflections replaces their temporal filter only when asked; the indirect light's runs.
  assert.equal(values.screenReflectionDenoiser, false)
  assert.equal(values.screenReflectionDenoiserSamples, 8)
  assert.equal(values.screenReflectionDenoiserPreConvolution, 1)
  assert.equal(values.screenReflectionDenoiserTemporal, true)
  assert.equal(values.screenGiDenoiser, true)
  assert.equal(values.screenGiDenoiserSamples, 8)
  assert.equal(values.screenGiDenoiserTemporal, true)
})

test('a method is one of its names, true its default and false off', () => {
  assert.equal(resolveSetting(RULES.reflectionMethod, 'screen'), 'screen')
  assert.equal(resolveSetting(RULES.reflectionMethod, false), 'off')
  assert.equal(resolveSetting(RULES.globalIlluminationMethod, true), 'scene')
  assert.throws(() => resolveSetting(RULES.reflectionMethod, 'probes' as never), /reflectionMethod/)
})

test('the level of the reflections follows the view quality under the cap', () => {
  assert.equal(screenReflectionQualityOf(50, 3, false), 'medium')
  assert.equal(screenReflectionQualityOf(60, 3, false), 'high')
  assert.equal(screenReflectionQualityOf(100, 3, false), 'high')
  assert.equal(screenReflectionQualityOf(80, 4, false), 'veryHigh')
  assert.equal(screenReflectionQualityOf(80, 3, false), 'high')
  assert.equal(screenReflectionQualityOf(39, 4, false), 'low')
  assert.equal(screenReflectionQualityOf(100, 1, false), 'low')
  assert.equal(screenReflectionQualityOf(0, 4, true), 'visualize')
})

test('the screen answers where the scene does not, the reflections falling back from any method but off', () => {
  assert.equal(resolveScreenSpaceMethod('scene', true, true, true), 'scene')
  assert.equal(resolveScreenSpaceMethod('scene', false, true, true), 'screen')
  assert.equal(resolveScreenSpaceMethod('scene', false, false, true), 'off')
  assert.equal(resolveScreenSpaceMethod('off', false, true, true), 'off')
  assert.equal(resolveScreenSpaceMethod('screen', true, true, true), 'screen')
  // The indirect light does not fall back: only the method 'screen' asks for it.
  assert.equal(resolveScreenSpaceMethod('scene', false, true, false), 'off')
  assert.equal(resolveScreenSpaceMethod('screen', false, true, false), 'screen')
})

test('the reflections run with a level, an intensity of at least 1 and a history; the indirect light with its method and level', () => {
  const values = defaults()
  assert.equal(screenReflectionsOn(values, true), true)
  assert.equal(screenReflectionsOn(values, false), false)
  assert.equal(screenReflectionsOn({ ...values, screenReflectionIntensity: 0.5 }, true), false)
  assert.equal(screenReflectionsOn({ ...values, screenReflectionLevel: 0 }, true), false)
  assert.equal(screenReflectionsOn({ ...values, reflectionMethod: 'off' }, true), false)
  assert.equal(screenIndirectOn(values, true), false)
  const screen = { ...values, globalIlluminationMethod: 'screen' as const }
  assert.equal(screenIndirectOn(screen, true), true)
  assert.equal(screenIndirectOn({ ...screen, screenGiLevel: 0 }, true), false)
  assert.equal(screenIndirectOn(screen, false), false)
})
