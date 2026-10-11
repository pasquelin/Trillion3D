import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LOD_QUALITY } from '../../../../sdk-core/src/lod/policy.ts'
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts'
import * as vsm from '../../vsm/constants.ts'
import { createWorldSettings } from './worldSettings.ts'

const WORLD_SETTINGS = createWorldSettings().table

/** Each setting and the value the engine reads today in its place. */
const TODAY: Record<keyof typeof WORLD_SETTINGS, boolean | number> = {
  pixelError: LOD_QUALITY.source.pixelError,
  antialiasing: true, // `WorldOptions.temporalAntialiasing`'s default
  bounce: false, // `world.bounce`'s default
  dynamicShadows: true,
  glass: true,
  particles: true,
  postProcessing: true,
  maxAnisotropy: MAX_ANISOTROPY,
  shadowPages: vsm.VSM_POOL_PAGES,
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
    else
      assert.ok(entry.default >= entry.range[0] && entry.default <= entry.range[1], `${name} out`)
  }
})

test('only the pages and the dynamic shadows drop the cache', () => {
  const dropping = Object.entries(WORLD_SETTINGS)
    .filter(([, entry]) => entry.invalidates === 'shadowCache')
    .map(([name]) => name)
    .sort()
  assert.deepEqual(dropping, ['dynamicShadows', 'shadowPages'])
})
