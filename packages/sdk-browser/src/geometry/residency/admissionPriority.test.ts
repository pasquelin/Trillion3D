import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuPageCache } from '../pages/pool/pages.ts'
import { createReadWatch } from '../streaming/readWatch.ts'
import { createWebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { readGeometryAhead } from '../rows/page/pageSlots.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { ensurerOptions, pageOf } from './residentEnsurer.fixture.ts'

test('a lower tier admitted by the WebGPU pool stays out of the loading total', async () => {
  // The streamer's read watch, over reads that land at once: what `onProgress` counts as `total`.
  const { read, watch } = createReadWatch(async () => new Uint8Array(4))
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })
  const cache = createGpuPageCache(device, { read }, { pageBytes: 4, slots: 4 })
  const camera = pageOf('camera'),
    ahead = pageOf('ahead')
  const tracking = createWebgpuPageTracking([camera, ahead])
  tracking.wanted.add(tracking.keyOf(camera), camera)
  const ensure = createWebgpuResidentEnsurer({
    ...ensurerOptions(tracking, cache),
    lowerTier: () => ({ pages: [ahead], revision: 0 }),
    prefetch: readGeometryAhead(
      new Map([
        ['camera', 'camera'],
        ['ahead', 'ahead'],
      ]),
      (url, signal, priority) => read(url, signal ?? new AbortController().signal, priority),
    ),
  })
  const progress = watch(() => {})
  await ensure([camera], 1, 1)
  progress.stop()
  assert.ok(cache.get('camera') && cache.get('ahead'), 'both pages admitted')
  assert.deepEqual(progress.reads(), { landed: 1, asked: 1 }, 'the view read the camera page alone')
})
