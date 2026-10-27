// The cut's and the dynamic resolution's setting rules: their defaults, their ranges and their refusals.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CUT_RULES } from './cutOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from './dynamicResolutionOptions.ts'
import { STREAMING_RULES } from './streamingOptions.ts'
import { resolveSetting, type SettingRule } from './settingRules.ts'

test('the cut culls an object by the distances it names, at their own size, unless asked otherwise', () => {
  assert.equal(CUT_RULES.cutDrawDistanceCulling.default, true)
  assert.equal(resolveSetting(CUT_RULES.cutDrawDistanceCulling, null), true)
  assert.equal(resolveSetting(CUT_RULES.cutDrawDistanceCulling, false), false)
  assert.throws(
    () => resolveSetting<SettingRule>(CUT_RULES.cutDrawDistanceCulling, 'no'),
    /true or false/,
  )
  // The draw distance is measured to the sphere's edge by default, the centre when turned off.
  assert.equal(CUT_RULES.cutDistanceCullToSphereEdge.default, true)
  assert.equal(resolveSetting(CUT_RULES.cutDistanceCullToSphereEdge, false), false)
  assert.throws(
    () => resolveSetting(CUT_RULES.cutDistanceCullToSphereEdge, 1 as never),
    /true or false/,
  )
  assert.equal(resolveSetting(CUT_RULES.cutViewDistanceScale, undefined), 1)
  assert.equal(resolveSetting(CUT_RULES.cutViewDistanceScale, 0), 0)
  assert.equal(resolveSetting(CUT_RULES.cutViewDistanceScale, 2.5), 2.5)
  assert.throws(
    () => resolveSetting(CUT_RULES.cutViewDistanceScale, -1),
    /a finite number of at least 0/,
  )
})

test('the cut applies no view’s clip plane unless asked, culls by it and filters by the lists unless asked otherwise', () => {
  assert.equal(CUT_RULES.cutClipPlane.default, false)
  assert.equal(CUT_RULES.cutClipPlaneCulling.default, true)
  assert.equal(CUT_RULES.cutViewFiltering.default, true)
  for (const field of ['cutClipPlane', 'cutClipPlaneCulling', 'cutViewFiltering'] as const) {
    assert.equal(resolveSetting(CUT_RULES[field], true), true)
    assert.equal(resolveSetting(CUT_RULES[field], false), false)
    assert.throws(() => resolveSetting<SettingRule>(CUT_RULES[field], 'no'), /true or false/)
  }
})

test('an orthographic view’s planes are worked out by default, its origin moved onto the near plane by its height where it frames no target, its range then starting at 0', () => {
  const { cutViewOrthoNearPlaneCorrection: moves, cutViewOrthoNearPlane: near } = CUT_RULES
  assert.equal(resolveSetting(CUT_RULES.cutViewCaptureDelay), 4, 'a capture draws four images')
  assert.equal(resolveSetting(CUT_RULES.cutViewCaptureDelay, 0), 0, 'read as 1 where it is used')
  assert.throws(() => resolveSetting(CUT_RULES.cutViewCaptureDelay, 1.5), /whole number/)
  assert.deepEqual(
    [
      CUT_RULES.cutViewOrthoAutoPlanes,
      CUT_RULES.cutViewOrthoAutoPlanesHalfFloat,
      CUT_RULES.cutViewOrthoAutoPlanesScaleUnits,
      CUT_RULES.cutViewOrthoAutoPlanesDepthScale,
      CUT_RULES.cutViewOrthoAutoPlanesShift,
      moves,
      CUT_RULES.cutViewOrthoCameraHeightAsViewTarget,
      near,
    ].map((rule) => resolveSetting(rule)),
    [true, true, true, -1, 0, true, true, 0],
  )
  assert.equal(resolveSetting(near, -2.5), -2.5)
  assert.equal(resolveSetting(CUT_RULES.cutViewOrthoAutoPlanesShift, -3), -3)
  for (const field of [
    'cutViewOrthoAutoPlanes',
    'cutViewOrthoAutoPlanesHalfFloat',
    'cutViewOrthoAutoPlanesScaleUnits',
    'cutViewOrthoNearPlaneCorrection',
    'cutViewOrthoCameraHeightAsViewTarget',
  ] as const)
    assert.throws(() => resolveSetting<SettingRule>(CUT_RULES[field], 1), /true or false/)
  assert.throws(() => resolveSetting(near, Infinity), /a (finite )?number/)
  assert.throws(
    () => resolveSetting(CUT_RULES.cutViewOrthoAutoPlanesDepthScale, NaN),
    /a (finite )?number/,
  )
})

test('the cut’s GPU time budget is off, its lowest scale 30 % from 1 to 100, the streaming’s bandwidth unlimited', () => {
  const { cutEdgeScaleBudgetMs: budget, cutEdgeScaleMinPercent: lowest } = CUT_RULES
  const { streamingBandwidthLimit: bandwidth } = STREAMING_RULES
  assert.deepEqual(
    [budget, lowest, bandwidth].map((rule) => resolveSetting(rule)),
    [0, 30, -1],
  )
  assert.deepEqual(
    [-4, 8.3].map((value) => resolveSetting(budget, value)),
    [-4, 8.3],
  )
  for (const bad of [0.5, 101, Infinity])
    assert.throws(() => resolveSetting(lowest, bad), /a number from 1 to 100/)
  assert.throws(() => resolveSetting(bandwidth, '1' as never), /a number from/)
})

test('the dynamic resolution’s eleven settings default to the reference’s and refuse what they do not take', () => {
  const rules = DYNAMIC_RESOLUTION_RULES
  assert.deepEqual(
    Object.values(rules).map((rule) => resolveSetting(rule)),
    [33.3, 0, 10, 0, 16, 0.9, 8, 0.9, 2, 2, false],
  )
  assert.equal(resolveSetting(rules.dynamicResolutionHistorySize, 4), 4)
  assert.throws(() => resolveSetting(rules.dynamicResolutionHistorySize, 0), /whole number/)
  // The rings are allocated at the next sample: a count the host names must be one they can hold.
  assert.equal(resolveSetting(rules.dynamicResolutionHistorySize, 4096), 4096)
  assert.throws(() => resolveSetting(rules.dynamicResolutionHistorySize, 4097), /from 1 to 4096/)
  assert.throws(
    () => resolveSetting(rules.dynamicResolutionHistorySize, 2 ** 31 - 1),
    /from 1 to 4096/,
  )
  assert.throws(() => resolveSetting(rules.dynamicResolutionHeadroomPercent, 100), /from 0 to 99/)
  assert.throws(
    () => resolveSetting(rules.dynamicResolutionIncreaseAmortization, 1.5),
    /from 0 to 1/,
  )
  assert.throws(() => resolveSetting(rules.dynamicResolutionFrameTimeBudgetMs, -1), /at least 0/)
  assert.throws(
    () => resolveSetting<SettingRule>(rules.dynamicResolutionUseCpuTimeLogic, 1),
    /true or false/,
  )
})

test('the cut’s secondary view distance scale is off and 1, a non-negative number', () => {
  const { cutViewDistanceApplySecondaryScale: apply, cutViewDistanceSecondaryScale: scale } =
    CUT_RULES
  assert.deepEqual(
    [apply, scale].map((rule) => resolveSetting(rule)),
    [false, 1],
  )
  assert.equal(resolveSetting(scale, 0.25), 0.25)
  assert.throws(() => resolveSetting(scale, -1), /at least 0/)
  assert.throws(() => resolveSetting<SettingRule>(apply, 1), /true or false/)
})
