// What the throttle's tests share: the shadow settings by name and a comparison within f32 rounding.
import assert from 'node:assert/strict'
import {
  resolveSettings,
  type SettingOptions,
} from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SHADOW_RULES } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'

export const settings = (options: SettingOptions<typeof SHADOW_RULES> = {}) =>
  resolveSettings(SHADOW_RULES, options)
export const close = (actual: number, expected: number, words: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${words}: ${actual} against ${expected}`)
