import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuPageCache } from '../../gpu/page/pages.ts'
import { createGpuPageReader } from '../../gpu/page/reader.ts'
import { createReadWatch } from '../../streaming/readWatch.ts'
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { readGeometryAhead } from '../row/pageSlots.ts'
import { createWebgpuResidentEnsurer } from './residentEnsurer.ts'
import { ensurerOptions, pageOf } from './residentEnsurer.fixture.ts'

test('a lower tier admitted by the WebGPU pool stays out of the loading total (#408)', async () => {
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
    lowerTiers: () => [
      { pages: [ahead], has: (key) => key === tracking.keyOf(ahead), revision: 0 },
    ],
    prefetch: readGeometryAhead(
      new Map([
        ['camera', 'camera'],
        ['ahead', 'ahead'],
      ]),
      read,
    ),
  })
  const progress = watch(() => {})
  await ensure([camera], 1, 1)
  progress.stop()
  assert.ok(cache.get('camera') && cache.get('ahead'), 'both pages admitted')
  assert.deepEqual(progress.reads(), { landed: 1, asked: 1 }, 'the view read the camera page alone')
})

test('a view read joining a prefetch in flight is counted and raises it (#408)', async () => {
  let land = () => {}
  const priorities: (number | undefined)[] = []
  const bytes = new Promise<Uint8Array>((resolve) => (land = () => resolve(new Uint8Array(4))))
  const { read, watch } = createReadWatch((_url, _signal, priority) => {
    priorities.push(priority)
    return bytes
  })
  const reader = createGpuPageReader({ read }, 4, undefined, new Map())
  const progress = watch(() => {})
  const signal = new AbortController().signal
  const prefetch = reader.fetchBytes('page', signal, PRIORITY_PREFETCH)
  assert.equal(reader.fetchBytes('page', signal), prefetch, 'the view joins the read in flight')
  assert.deepEqual(progress.reads(), { landed: 0, asked: 1 }, 'the view waits on the page')
  land()
  await prefetch
  await Promise.resolve()
  assert.deepEqual(progress.reads(), { landed: 1, asked: 1 })
  assert.deepEqual(priorities, [PRIORITY_PREFETCH, undefined], 'the source heard the raise')
  reader.fetchBytes('page', signal)
  assert.equal(priorities.length, 2, 'a raised read is not asked again')
  progress.stop()
})
