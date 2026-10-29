// The settings of the G-buffer write and of the hair debug views: their defaults and their ranges.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HAIR_STRANDS_RULES } from './hairStrandsOptions.ts'
import { resolveSettings, settingFits } from './settingRules.ts'

test("the debug settings default to the reference's values", () => {
  const settings = resolveSettings(HAIR_STRANDS_RULES, {})
  assert.equal(settings.hairWriteGBufferData, 1)
  assert.equal(settings.hairCastShadowWhenOutOfViewDebug, false)
  assert.equal(settings.hairDeepShadowDebugIndex, 0)
  assert.equal(settings.hairDeepShadowDebugScale, 20)
  assert.equal(settings.hairVoxelDebugTraversal, 'linear')
  assert.equal(settings.hairVoxelDebugDrawVoxels, true)
  assert.equal(settings.hairVoxelDebugDrawPages, false)
  assert.equal(settings.hairVoxelDebugForcedMip, -1)
})

test('the G-buffer write is a whole number from 0 to 3 and the traversal is linear or mip', () => {
  const rule = HAIR_STRANDS_RULES
  for (const value of [0, 1, 2, 3]) assert.ok(settingFits(rule.hairWriteGBufferData, value))
  for (const value of [-1, 4, 1.5]) assert.ok(!settingFits(rule.hairWriteGBufferData, value))
  assert.ok(settingFits(rule.hairVoxelDebugTraversal, 'mip'))
  assert.ok(!settingFits(rule.hairVoxelDebugTraversal, 'cone'))
  assert.ok(!settingFits(rule.hairDeepShadowDebugIndex, -1))
})
