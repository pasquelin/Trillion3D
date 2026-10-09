import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { answering, refusedWith } from '../../cluster/answers.fixture.ts'
import { eventually } from '../../streaming/eventually.fixture.ts'
import { createGpuPageCache, httpPageSource } from './pages.ts'

const BASE = 'https://cache.test/model/pages/'
const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })

/** Whether `error` is the streamer's refusal of a read the server refused with `status`. */
const failedWith = (status: number) => (error: unknown) =>
  error instanceof Error &&
  /PAGE_STREAM_FAILED/.test(error.message) &&
  refusedWith(status, 'p0.bin')(error.cause)

test('a page the server does not hold (404) is refused by its address, never asked again', async (t) => {
  const asked = answering(t, 'p0.bin', [404])
  const cache = createGpuPageCache(device, httpPageSource(BASE), { pageBytes: 8, slots: 1 })
  // Another request would meet the same refusal.
  await assert.rejects(cache.load('p0.bin'), failedWith(404))
  await assert.rejects(cache.load('p0.bin'), /PAGE_STREAM_FAILED/)
  assert.equal(asked.length, 1)
  await cache.dispose()
})

test('a page a busy server refuses (503) waits its turn, its loads waiting on it: asked again once its wait ended', async (t) => {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const asked = answering(t, 'p0.bin', [503, 200], () => new Uint8Array([1, 2, 3, 4]))
  const cache = createGpuPageCache(device, httpPageSource(BASE), { pageBytes: 8, slots: 1 })
  const first = cache.load('p0.bin')
  await eventually(() => asked.length === 1)
  await new Promise(setImmediate)
  // Within its wait, a load joins the read that waits, and sends no request.
  const second = cache.load('p0.bin')
  await new Promise(setImmediate)
  assert.equal(asked.length, 1)
  clock.now = 500
  t.mock.timers.tick(500)
  const [page, again] = await Promise.all([first, second])
  assert.deepEqual([page.bytes, again, asked.length], [4, page, 2], 'asked once its wait ended')
  await cache.dispose()
})

test('loads of a key in flight join its one read; ended, the read is forgotten: nothing is kept', async (t) => {
  const asked = answering(t, 'p0.bin', [200], () => new Uint8Array([1, 2, 3, 4]))
  const source = httpPageSource(BASE)
  const [first, joined] = await Promise.all([source.read('p0.bin'), source.read('p0.bin')])
  assert.deepEqual([first, asked.length], [joined, 1], 'one request')
  await source.read('p0.bin')
  assert.equal(asked.length, 2, 'read again: the source keeps no page')
  source.dispose()
})

test('a read every load left is stopped', async (t) => {
  const asked = answering(t, 'p0.bin', ['hang'])
  const source = httpPageSource(BASE)
  const leave = new AbortController()
  const load = source.read('p0.bin', leave.signal)
  await eventually(() => asked.length === 1)
  leave.abort()
  await assert.rejects(load, { name: 'AbortError' })
  assert.equal(asked[0].init.signal?.aborted, true, 'its request cancelled')
  source.dispose()
})
