import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import {
  resolveSettingsInto,
  type SettingValues,
} from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { LightingImage } from './params.ts'

/** The lighting's settings at their defaults. */
export const lightingSettings = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, lightingSettings)

/** That `a` is `b`, to `tolerance`. */
export const near = (a: number, b: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`)

/** A view the words under test do not read: any matrix will do. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** An image the lighting's words are written for: the first frame, one page, the eye at the origin, the view `IDENTITY`,
 *  no history lost, no feedback — what `image` names in place. */
export const lightingImage = (image: Partial<LightingImage> = {}): LightingImage => ({
  frame: 1,
  pages: 1,
  eye: [0, 0, 0],
  viewProjection: IDENTITY,
  preExposure: 1,
  viewPreExposure: 1,
  firstClipmapExtent: 2500,
  historyLost: false,
  feedback: false,
  ...image,
})
