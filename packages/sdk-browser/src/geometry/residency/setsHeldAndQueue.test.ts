import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { PageRec } from '../selection/types.ts'
import type { GpuCut } from '../../gpu/core/selection.ts'
import type { GpuPageCache } from '../pages/pool/pages.ts'
import { createCutDelta } from '../cut/adoption/delta.ts'
import { createReadFailures } from '../streaming/failures.ts'
import { REQUEST_PRIORITY_MAX } from '../dag/request/request.ts'
import { createPageRequests } from './pageRequests.ts'
import { paceFrame, pumpOn } from './queueInstalls.ts'
import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { start } from './queueStarts.ts'
import { createQueueState, limitsOf, type QueueOptions } from './queueState.ts'
import { frame, keysOf, rec, scene, world } from './sets.fixture.ts'

test('what the image draws is held even when the cut never asked for it', () => {
  const world = scene()
  const { sets, tracking, packed } = world
  const at = (id: number) => tracking.keyOf(packed[id])
  const drawn = createCutDelta(packed, [] as PageRec[])
  // The cut asks for two fine clusters whose pages have not arrived, so the image draws a coarse
  // ancestor the cut never named. Nothing else holds it: without this hold the cache is free to
  // reclaim, under the image, the surface that image is showing.
  frame(world, [4, 6])
  drawn.apply([12])
  sets.applyDrawn(drawn)
  assert.equal(tracking.keep.has(at(12)), true, 'drawn ancestor kept')
  assert.equal(tracking.wanted.has(at(12)), false, 'drawn ancestor not requested')
  // The fine clusters arrive and take the image: the ancestor leaves it, and the hold leaves with it.
  drawn.apply([4, 6])
  sets.applyDrawn(drawn)
  assert.equal(
    tracking.keep.has(at(12)),
    false,
    'ancestor released as soon as it is no longer drawn',
  )
  assert.equal(tracking.keep.has(at(4)), true)
  // A drawable cut that does not move touches nothing at all.
  drawn.apply([4, 6])
  assert.equal(drawn.enteredCount + drawn.exitedCount, 0)
  const before = keysOf(tracking.keep)
  sets.applyDrawn(drawn)
  assert.deepEqual(keysOf(tracking.keep), before)
})

/** A queue over the pages `urls`, a streaming page each, started in that order: their reads settle
 *  when the test says (`settle`), the page `a/…` are one object, each other page its own. */
function startedOver(urls: string[], rooted = (_url: string) => false) {
  const w = world(urls.map((url) => rec(url, 0)))
  const failures = createReadFailures({
    retriable: () => false,
    objectOf: (url) => (url.startsWith('a/') ? 0 : urls.indexOf(url) + 1),
  })
  const settle = new Map<string, { done(): void; fail(error: Error): void }>()
  const installed: string[] = []
  const cache = {
    ...{ room: () => urls.length, rootRoom: () => urls.length, holds: () => false },
    rooted: (address: string) => rooted(address),
    unload: () => {},
    load: async (address: string) => void installed.push(address),
  } as unknown as GpuPageCache
  const s = createQueueState({
    ...{ tracking: w.tracking, sets: w.sets, packedPages: w.packed, settings: {} },
    ...{ closure: { closeOver() {} }, parentsOf: () => [], hasBytes: () => false },
    read: (page: PageRec) =>
      new Promise<void>((done, fail) => settle.set(page.url, { done, fail })),
    // As the page streamer says it (`failed`): given up, or its object invalid.
    invalid: (page: PageRec) => failures.blocked(page.url)?.state === 'refused',
    ...{ markLost() {}, diagnosticFailure() {} },
  } as unknown as QueueOptions)
  s.cache = cache
  // The first page asked the most: the pages start, and install, in the order of `urls`.
  const pages = Int32Array.from(urls, (_, at) => at),
    priorities = Uint32Array.from(urls, (_, at) => urls.length - at)
  const requests = { pages, counts: new Int32Array(urls.length).fill(1), priorities }
  s.requests.take([{ result: { requests } }] as unknown as GpuCut[])
  start(s, cache, () => undefined)
  pumpOn(s)
  const unit = (url: string) => w.tracking.units.of(w.tracking.keyOf(rec(url, 0)))
  return { s, w, failures, settle, installed, unit }
}

test('a page on its way for an object given up is dropped when it arrives, not installed', async () => {
  const { s, w, failures, settle, installed, unit } = startedOver(['a/p1', 'a/p2', 'b/p3'])
  // `a/p1` fails for good, its object invalid; `a/p2` and `b/p3` were on their way and arrive.
  const error = new Error('404')
  failures.record('a/p1', error)
  settle.get('a/p1')!.fail(error)
  settle.get('a/p2')!.done()
  settle.get('b/p3')!.done()
  await s.pump
  assert.deepEqual(installed, ['b/p3'], 'only the page of the object still valid is installed')
  const { streamed } = w.sets
  assert.deepEqual(
    ['a/p1', 'a/p2', 'b/p3'].map((url) => streamed.has(unit(url))),
    [false, false, true],
    'the dropped pages are let go as a page that failed is',
  )
  assert.deepEqual(
    [...s.refused].sort(),
    [unit('a/p1'), unit('a/p2')].sort(),
    'never started again',
  )
})

test('a prefetch keeps the priority its asker names up to the highest; 0 asks for nothing', () => {
  const w = world(['p0', 'p1', 'p2', 'p3', 'p4'].map((url) => rec(url, 0)))
  const requests = createPageRequests({
    ...{ packedPages: w.packed, keyOf: w.tracking.keyOf, units: w.tracking.units },
    ...{ parents: () => [], covers: w.sets.covers, closure: { closeOver() {} } },
  })
  // A priority named, one named past the highest, 0, not a number, and none named.
  requests.prefetch([0], 1, 7)
  requests.prefetch([1], 1, 2 ** 40)
  requests.prefetch([2], 1, 0)
  requests.prefetch([3], 1, Number.NaN)
  requests.prefetch([4], 1)
  requests.take([])
  const priority = (at: number) =>
    requests.priorityOf(w.tracking.units.of(w.tracking.keyOf(w.packed[at])))
  assert.deepEqual([0, 1, 2, 3, 4].map(priority), [
    7,
    REQUEST_PRIORITY_MAX,
    0,
    0,
    REQUEST_PRIORITY_MAX - 1,
  ])
})

/** Microtask turns: the install loop's awaits settle on them, never on a task. */
const turns = async (count = 12) => {
  for (let turn = 0; turn < count; turn++) await Promise.resolve()
}

/** The queue over pages of `bytes` each, 1 MB a second the simulated bandwidth; `arrive()` brings
 *  every page's bytes in. The install loop ends with the test, whatever it waits for. */
function slowLink(
  t: TestContext,
  urls: string[],
  bytes: number,
  rooted?: (url: string) => boolean,
) {
  const link = startedOver(urls, rooted)
  t.after(() => void (link.s.lost = new Error('end of the test')))
  Object.assign(link.s.o.settings, { streamingBandwidthLimit: 1 })
  link.s.limits = limitsOf(link.s.o.settings)
  for (const url of urls)
    Object.assign(link.w.tracking.units.records(link.unit(url))[0], { indexBytes: bytes })
  return { ...link, arrive: () => urls.forEach((url) => link.settle.get(url)!.done()) }
}

test(
  'the pages of a frame share its bandwidth in the order started: the rate is the setting’s, whatever the pages’ sizes',
  { timeout: 5000 },
  async (t) => {
    const { s, installed, arrive } = slowLink(t, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], 40000)
    arrive()
    // An update a tenth of a second: 104 857 bytes at 1 MB/s, the first with none behind it.
    const frame = async (ms: number) => {
      if (ms > 0) s.gate.frame()
      paceFrame(s, ms)
      await turns()
      return [installed.length, s.pending[0]?.bytesLeft]
    }
    assert.deepEqual(await frame(0), [0, 40000], 'no time behind the first frame: no byte')
    assert.deepEqual(await frame(100), [2, 15143], 'two pages and a part of the third, not all six')
    assert.deepEqual(
      await frame(200),
      [5, 30286],
      'the rest of the third, two more and a part of the sixth',
    )
    assert.equal(s.pacing.bytesLeft, 0, 'the frame’s bytes taken')
    assert.ok(installed.length * 40000 <= (200 / 1000) * 1048576, 'never over the rate')
  },
)

test(
  'a frame the gate counts when no update came takes the time it really took, not the last update’s bytes',
  { timeout: 5000 },
  async (t) => {
    const { s, installed, arrive } = slowLink(t, ['p0', 'p1'], 40000)
    s.pacing.bandwidthFrame = s.gate.count
    s.pacing.bandwidthAt = cpuNow()
    s.pacing.bytesLeft = 0
    arrive()
    await turns()
    s.gate.frame()
    await turns()
    assert.equal(s.pacing.bandwidthFrame, s.gate.count, 'paced by the first page that asked')
    assert.ok(s.pacing.bytesLeft < 1048576, 'a few microseconds of the link')
    assert.deepEqual(installed, [], 'the link holds')
  },
)

test(
  'a limit of zero installs no streaming page but a root one, whole; a negative one reads no clock',
  { timeout: 5000 },
  async (t) => {
    const { s, installed, arrive } = slowLink(t, ['r/p0', 'a/p1'], 4096, (url) =>
      url.startsWith('r/'),
    )
    arrive()
    Object.assign(s.o.settings, { streamingBandwidthLimit: 0 })
    s.limits = limitsOf(s.o.settings)
    paceFrame(s, 0)
    s.gate.frame()
    paceFrame(s, 1000)
    await turns()
    assert.deepEqual(installed, ['r/p0'], 'the root page is not slowed, the other never comes')
    Object.assign(s.o.settings, { streamingBandwidthLimit: -1 })
    s.limits = limitsOf(s.o.settings)
    s.pacing.bandwidthAt = 5
    paceFrame(s)
    assert.equal(s.pacing.bandwidthAt, undefined, 'no limit: the clock is forgotten, never read')
    s.gate.frame()
    await s.pump
    assert.deepEqual(installed, ['r/p0', 'a/p1'], 'a negative limit waits for nothing')
  },
)
