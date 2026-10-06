// A residency job's progress (#836): the loop waits for the job's next camera page, not its last,
// so the frames draw while a long job loads instead of showing the coarse cut until it ends.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuPageTracking } from '../row/pageTracking.ts'
import { createWebgpuResidencyQueue } from './queue.ts'
import { lruCache, pageOf, tierEnsurer } from './residentEnsurer.fixture.ts'

test('the ensurer hears each camera page it lands, never a lower tier page', async () => {
  const pages = ['a', 'b', 'c', 'ahead'].map(pageOf)
  const tracking = createWebgpuPageTracking(pages)
  const camera = pages.slice(0, 3)
  for (const page of camera) tracking.wanted.add(tracking.keyOf(page), page)
  const cache = lruCache(4)
  await cache.load('a')
  let landed = 0
  const ensure = tierEnsurer(
    tracking,
    cache,
    () => [],
    () => [pages[3]],
  )
  await ensure(
    camera,
    1,
    1,
    () => false,
    () => landed++,
  )
  assert.ok(cache.get('ahead'), 'the tier ahead loaded too')
  assert.equal(landed, 2, 'b and c: the resident page and the tier ahead are not heard')
})

const queueOf = (
  ensureResident: Parameters<typeof createWebgpuResidencyQueue>[0]['ensureResident'],
) =>
  createWebgpuResidencyQueue({
    tracking: createWebgpuPageTracking([]),
    sets: { desiredCount: 0, followDesired() {} } as never,
    closure: {} as never,
    room: () => 0,
    getCache: () => undefined,
    getFrame: () => 0,
    updatePins() {},
    ensureResident,
    markLost() {},
    traceEnabled: false,
    traceDiagnostic() {},
    diagnosticFailure() {},
  })

test('progress resolves at each page landed, heard or not, while the job runs, and at its end', async () => {
  let release!: () => void
  const gate = new Promise<void>((open) => (release = open))
  const queue = queueOf(async (_wanted, _frame, _job, _waiting, landed) => {
    landed()
    await new Promise(setImmediate)
    landed() // while no frame waits
    await gate
  })
  queue.queueCutResidency()
  const heard: string[] = []
  void queue.progress().then(() => heard.push('progress'))
  void queue.pending.then(() => heard.push('pending'))
  await new Promise(setImmediate)
  assert.deepEqual(heard, ['progress'], 'a page landed: the next frame can draw it')
  await new Promise(setImmediate)
  void queue.progress().then(() => heard.push('landed unheard'))
  void queue.progress().then(() => heard.push('next'))
  await new Promise(setImmediate)
  assert.deepEqual(heard, ['progress', 'landed unheard'], 'a page no frame waited for is drawn')
  release()
  await queue.pending
  await new Promise(setImmediate)
  assert.deepEqual(heard, ['progress', 'landed unheard', 'pending', 'next'])
  assert.equal(queue.progress(), queue.pending, 'no job running: its end is all there is to wait')
  assert.equal(queue.landings, 2, 'the loop counts both landings')
})

test('a failed job rejects the frame waiting on it with its error, and the wait after', async () => {
  let fail!: (error: Error) => void
  const queue = queueOf(() => new Promise<void>((_, reject) => (fail = reject)))
  queue.queueCutResidency()
  await new Promise(setImmediate)
  const woken = queue.progress()
  fail(new Error('PAGE_STREAM_FAILED'))
  await assert.rejects(woken, /PAGE_STREAM_FAILED/)
  await assert.rejects(queue.progress(), /PAGE_STREAM_FAILED/)
})
