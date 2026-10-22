import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'
import { DEFAULT_TEMPORAL_AA_LEVEL } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
  RASTER_RULES,
} from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import {
  DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME,
  DEFAULT_STREAMING_MAX_PENDING_PAGES,
  DEFAULT_STREAMING_MAX_REQUESTS,
  DEFAULT_STREAMING_MIN_REQUESTS,
  DEFAULT_STREAMING_NUM_RETRIES,
  DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT,
  DEFAULT_STREAMING_QUALITY_MIN_SCALE,
} from '../../../../sdk-core/src/contracts/streamingOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { WORLD_STREAMING_RULES } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { ANIMATION_RULES } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import { SHADING_RULES } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { createWorldSettings } from './settings.ts'

const WORLD_SETTINGS = createWorldSettings().table

/** Each setting and the value the engine reads today in its place. */
const TODAY: Record<keyof typeof WORLD_SETTINGS, boolean | number | string> = {
  pixelError: DEFAULT_PIXEL_ERROR,
  antialiasing: DEFAULT_TEMPORAL_AA_LEVEL, // `WorldOptions.temporalAntialiasing`'s default
  bounce: true, // `world.bounce`'s default
  softwareRaster: RASTER_RULES.softwareRaster.default, // on, the reference's own
  hardwareRasterEdgePixels: DEFAULT_HARDWARE_RASTER_EDGE_PIXELS,
  streamingMaxPendingPages: DEFAULT_STREAMING_MAX_PENDING_PAGES,
  streamingMaxInstallsPerFrame: DEFAULT_STREAMING_MAX_INSTALLS_PER_FRAME,
  streamingQualityMinPoolPercent: DEFAULT_STREAMING_QUALITY_MIN_POOL_PERCENT,
  streamingQualityMaxPoolPercent: DEFAULT_STREAMING_QUALITY_MAX_POOL_PERCENT,
  streamingQualityMinScale: DEFAULT_STREAMING_QUALITY_MIN_SCALE,
  streamingNumRetries: DEFAULT_STREAMING_NUM_RETRIES,
  streamingMinRequests: DEFAULT_STREAMING_MIN_REQUESTS,
  streamingMaxRequests: DEFAULT_STREAMING_MAX_REQUESTS,
  // The partition's streaming and the HLOD warm-up: each its contract's default.
  ...resolveSettings(WORLD_STREAMING_RULES, {}),
  // The cut's occlusion, culls and level-of-detail bias: each its contract's default.
  ...resolveSettings(CUT_RULES, {}),
  // The animation the GPU plays: each its contract's default.
  ...resolveSettings(ANIMATION_RULES, {}),
  // The material shading's bins: each its contract's default.
  ...resolveSettings(SHADING_RULES, {}),
  // The exposure's bias, range, histogram, shares, speeds and luminance, and the local
  // exposure's contrasts, detail, blur, grey and thresholds: each its contract's default.
  ...resolveSettings(EXPOSURE_RULES, {}),
  // The temporal pass's thin geometry detection: off, its contract's default.
  ...resolveSettings(TEMPORAL_RULES, {}),
}

test('every default is the constant the engine reads today, and a fresh registry resolves it', () => {
  const settings = createWorldSettings()
  assert.deepEqual(Object.keys(WORLD_SETTINGS).sort(), Object.keys(TODAY).sort())
  for (const [name, value] of Object.entries(TODAY)) {
    const key = name as keyof typeof WORLD_SETTINGS
    assert.equal(WORLD_SETTINGS[key].default, value, name)
    assert.equal(settings.get(key), value, name)
  }
})

test('every default lies within its own bounds', () => {
  for (const [name, entry] of Object.entries(WORLD_SETTINGS)) {
    if (entry.kind === 'flag') assert.equal(typeof entry.default, 'boolean', name)
    else if (entry.kind === 'choice')
      assert.ok(
        entry.choices.some((choice) => choice === entry.default),
        `${name} out`,
      )
    else
      assert.ok(entry.default >= entry.range[0] && entry.default <= entry.range[1], `${name} out`)
  }
})
