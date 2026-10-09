import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { answering, refusedWith } from '../../cluster/answers.fixture.ts'
import { createGpuPageCache, httpPageSource } from './pages.ts'

const BASE = 'https://cache.test/model/pages/'
const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })

test('a page the server does not hold (404) is refused by its address, never asked again', async (t) => {
  const asked = answering(t, 'p0.bin', [404])
  const cache = createGpuPageCache(device, httpPageSource(BASE), { pageBytes: 8, slots: 1 })
  // Another request would meet the same refusal.
  await assert.rejects(cache.load('p0.bin'), refusedWith(404, 'p0.bin'))
  await assert.rejects(cache.load('p0.bin'), /PAGE_STREAM_FAILED/)
  assert.equal(asked.length, 1)
  await cache.dispose()
})

test('a page a busy server refuses (503) is not asked again before its wait, its status reported', async (t) => {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const asked = answering(t, 'p0.bin', [503, 200], () => new Uint8Array([1, 2, 3, 4]))
  const phases: Array<{ phase: string; context: Record<string, unknown> }> = []
  const cache = createGpuPageCache(device, httpPageSource(BASE), {
    ...{ pageBytes: 8, slots: 1 },
    onDiagnostic: (event) => phases.push(event),
  })
  await assert.rejects(cache.load('p0.bin'), refusedWith(503, 'p0.bin'))
  assert.ok(
    phases.some((event) => event.phase === 'gpu-page-read-end' && event.context.status === 503),
  )
  // Within its wait, a load sends no request.
  await assert.rejects(cache.load('p0.bin'), /PAGE_STREAM_FAILED/)
  assert.equal(asked.length, 1)
  clock.now = 500
  t.mock.timers.tick(500)
  assert.equal((await cache.load('p0.bin')).bytes, 4)
  assert.equal(asked.length, 2, 'asked once its wait ended')
  await cache.dispose()
})
