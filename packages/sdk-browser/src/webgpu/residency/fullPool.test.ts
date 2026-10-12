// A pool whose every slot the image pins takes no page: a page read for it would be read for
// nothing, and read again by the next image, every image, while nothing frees a slot. So no read
// is asked until a slot can take it; the burst stops there, nothing dropped, and the page comes
// once a pin is let go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { ensurerOptions, orderedPool, pageOf } from './residentEnsurer.fixture.ts'

test('a pool its pins fill reads no page, image after image, until a pin is let go', async () => {
  const pages = ['held 0', 'held 1', 'asked'].map(pageOf)
  const tracking = createWebgpuPageTracking(pages)
  const cache = orderedPool(2)
  for (const page of pages.slice(0, 2)) await cache.load(page.url, undefined, true)
  cache.reads.length = 0
  const ensure = createWebgpuResidentEnsurer(ensurerOptions(tracking, cache))
  const asked = pages[2]
  tracking.wanted.add(tracking.keyOf(asked), asked)
  for (let image = 0; image < 3; image++) await ensure([asked], image, image)
  assert.deepEqual(cache.reads, [], 'no read while every slot is pinned')
  cache.unpin(pages[0].url)
  await ensure([asked], 3, 3)
  assert.deepEqual(cache.reads, ['asked'], 'read once a slot frees')
  assert.ok(cache.get('asked'))
})
