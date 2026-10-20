import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'
import { DEFAULT_TEMPORAL_AA_LEVEL } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import { createWorldSettings } from './settings.ts'

const WORLD_SETTINGS = createWorldSettings().table

/** Each setting and the value the engine reads today in its place. */
const TODAY: Record<keyof typeof WORLD_SETTINGS, boolean | number | string> = {
  pixelError: DEFAULT_PIXEL_ERROR,
  antialiasing: DEFAULT_TEMPORAL_AA_LEVEL, // `WorldOptions.temporalAntialiasing`'s default
  bounce: false, // `world.bounce`'s default
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
      assert.ok(entry.choices.includes(entry.default), `${name} out`)
    else
      assert.ok(entry.default >= entry.range[0] && entry.default <= entry.range[1], `${name} out`)
  }
})
