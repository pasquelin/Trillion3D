// The pages of the virtual surface (`virtualSurface.ts`): a capture confirmed after its page left.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../contracts/surfaceCacheOptions.ts'
import { resolveSettingsInto, type SettingValues } from '../../contracts/settingRules.ts'
import { createSurfaceCache, newPage } from './state.ts'
import { confirmPages } from './virtualSurface.ts'

const defaults = {} as SettingValues<typeof SURFACE_CACHE_RULES>
resolveSettingsInto(SURFACE_CACHE_RULES, {}, defaults)

test('a capture whose page left before it was confirmed confirms nothing: the image’s eviction can empty the mip it was planned in', () => {
  const cache = createSurfaceCache(defaults)
  const first = cache.pages.addSpan(2, () => ({ ...newPage(), pending: true }))
  cache.pages.removeSpan(first, 2)
  assert.doesNotThrow(() => confirmPages(cache, [first, first + 1]))
  assert.equal(cache.changes.pages.count, 0)
  assert.equal(cache.changes.cards.count, 0)
})
