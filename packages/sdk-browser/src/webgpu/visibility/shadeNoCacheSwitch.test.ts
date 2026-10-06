// `trillion3dShadeNoCache=1` (`shadeCache.ts`), temporary: the material cache's baseline in the same
// build — no pass built nor encoded, nothing cleared, the header alone bound, and the class
// pipelines told nothing: each pixel composes and decodes its own. Its own file: the switch is
// held at its first read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { LazyComputePass } from '../../gpu/core/lazyComputePass.ts'
import { SHADE_CACHE_HEADER_WORDS } from '../../visibility/shader/shadeCacheWgsl.ts'

test('without the cache no pass runs and the pixels compute their own', async () => {
  Object.assign(globalThis, { location: { search: '?trillion3dShadeNoCache=1' } })
  const { createShadeCache } = await import('./shadeCache.ts')
  const { device, bindGroupLayouts } = fakeDevice()
  const cache = await createShadeCache(device)
  assert.deepEqual([cache.constants, bindGroupLayouts.length], [{}, 0])
  cache.layFor(10, 36, 64, 64)
  assert.equal(cache.buffer.size, SHADE_CACHE_HEADER_WORDS * 4)
  let encoded = 0
  const encoder = {
    clearBuffer: () => void encoded++,
    beginComputePass: () => void encoded++,
  } as unknown as GPUCommandEncoder
  cache.encode(new LazyComputePass('shade cache').begin(encoder), {} as never)
  assert.equal(encoded, 0)
})
