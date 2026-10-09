// A pool whose every slot the image pins takes no page: a page read for it would be read for
// nothing, and read again by the next image, every image, while nothing frees a slot. So no read
// is asked until a slot can take it; the burst stops there, nothing dropped, and the page comes
// once a pin is let go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { ensurerOptions, lruCache, pageOf } from './residentEnsurer.fixture.ts'

test('a pool its pins fill reads no page, image after image, until a pin is let go', async () => {
  const pages = ['held 0', 'held 1', 'asked'].map(pageOf)
  const tracking = createWebgpuPageTracking(pages)
  const cache = lruCache(2),
    loads: string[] = []
  const load = cache.load
  cache.load = async (url: string, signal?: AbortSignal, tier?: 'held' | 'pinned') => (
    loads.push(url),
    load(url, signal, tier)
  )
  for (const page of pages.slice(0, 2)) await load(page.url, undefined, 'pinned')
  const ensure = createWebgpuResidentEnsurer(ensurerOptions(tracking, cache))
  const asked = pages[2]
  tracking.wanted.add(tracking.keyOf(asked), asked)
  for (let image = 0; image < 3; image++) await ensure([asked], image, image)
  assert.deepEqual(loads, [], 'no read while every slot is pinned')
  cache.unpin(pages[0].url)
  await ensure([asked], 3, 3)
  assert.deepEqual(loads, ['asked'], 'read once a slot frees')
  assert.ok(cache.get('asked'))
})
