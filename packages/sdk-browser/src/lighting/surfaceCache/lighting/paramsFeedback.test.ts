import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../../../../sdk-core/src/contracts/surfaceCacheOptions.ts'
import {
  resolveSettingsInto,
  type SettingValues,
} from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { LIGHTING_FLAG, LIGHTING_PARAMS } from './layout.ts'
import { shapeOf, writeLightingParams } from './params.ts'

const settings = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, settings)

/** A view the flags do not read: any matrix will do. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

test('the feedback prioritises the pages only where the setting is on (default on) and the image says the hardware path and the buffer are there', () => {
  assert.equal(settings.surfaceCacheLightingFeedback, true)
  const flagsOf = (image: boolean, setting: boolean) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(
      words,
      shapeOf(settings, 1024, false),
      { ...settings, surfaceCacheLightingFeedback: setting },
      {
        frame: 1,
        pages: 1,
        eye: [0, 0, 0],
        viewProjection: IDENTITY,
        preExposure: 1,
        viewPreExposure: 1,
        firstClipmapExtent: 2500,
        historyLost: false,
        feedback: image,
      },
    )
    return words[LIGHTING_PARAMS.at.flags] & LIGHTING_FLAG.feedback
  }
  assert.equal(flagsOf(true, true), LIGHTING_FLAG.feedback)
  assert.equal(flagsOf(false, true), 0)
  assert.equal(flagsOf(true, false), 0)
  assert.equal(flagsOf(false, false), 0)
  // One bit of its own, among the flags.
  const bits = Object.values(LIGHTING_FLAG)
  assert.equal(new Set(bits).size, bits.length)
  assert.ok(bits.every((bit) => Number.isInteger(Math.log2(bit))))
})
