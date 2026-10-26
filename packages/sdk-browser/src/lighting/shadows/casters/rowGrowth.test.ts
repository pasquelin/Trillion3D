// The shadow raster's buffers sized by what is cast — the casters' list and decoded clusters by the
// clusters that may cast — are made again, larger, when what they hold room for outgrows them, and
// held while it fits: what they hold is rewritten each frame (`renderCandidatesWgsl.ts`), nothing is
// copied, and the old ones are destroyed. (The spheres of the packed pages are gone with the
// raster's chunks they sized.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { casterFeedBytes, ensureCasterFeed, releaseCasterFeed } from './casterFeed.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

test('the casters are held while the clusters that may cast fit, made again larger when they outgrow them', () => {
  const { device, destroyed } = fakeDevice()
  const rt = { lights: {} } as unknown as WebgpuPagesRuntime
  const first = ensureCasterFeed(rt, device, 10)
  assert.ok(first.cap >= 10)
  assert.equal(ensureCasterFeed(rt, device, first.cap), first, 'as many: the same casters')
  const grown = ensureCasterFeed(rt, device, first.cap + 1)
  assert.notEqual(grown, first)
  assert.ok(grown.cap > first.cap)
  assert.ok(
    [first.list, first.pages, first.work, first.args].every((buffer) => destroyed.includes(buffer)),
    'the old casters are freed',
  )
  assert.equal(rt.lights.casters, grown)
  const bytes = casterFeedBytes(grown.cap)
  assert.equal(
    bytes,
    [grown.list, grown.pages, grown.work, grown.args].reduce((sum, { size }) => sum + size, 0),
    'the bytes the budget reserves are the buffers made',
  )
  releaseCasterFeed(grown)
  assert.ok(destroyed.includes(grown.pages))
})
