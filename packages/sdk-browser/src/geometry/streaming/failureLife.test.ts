// How long a failure is kept: while the wait its server asked runs, past its page; a refusal for
// good leaves with its page; a failure is remembered, its tries counting on, till its key passes or
// its owner lets it go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import { createReadFailures } from './failures.ts'
import { eventually } from './eventually.fixture.ts'
import { idle, refusing } from './failures.fixture.ts'

test('a failure outlives its page while the wait its server asked runs, then leaves; one for good leaves with it', async (t) => {
  const { streamer, sent, until, clock, settle } = refusing(t, 503, ['a.bin'], {
    'retry-after': '1',
  })
  const page = { url: 'a.bin', bytes: 4, sha256: '' }
  const leaving = new AbortController()
  void streamer.readBytes('a.bin', leaving.signal).catch(() => {})
  await settle()
  leaving.abort()
  streamer.forget(['a.bin'])
  streamer.admit([page])
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  assert.deepEqual(sent, [0], 'admitted again within its wait: it waits it out')
  await until(1_000)
  assert.deepEqual(sent, [0, 1_000], 'asked once its wait ended')
  assert.equal(clock.now, 1_000)
})

test('a refusal for good leaves with its page: nothing asks it any more', async (t) => {
  const { streamer } = refusing(t, 404)
  await streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  assert.deepEqual([streamer.failed('a.bin'), streamer.stats().failed], [true, 1])
  streamer.forget(['a.bin'])
  assert.deepEqual([streamer.failed('a.bin'), streamer.stats().failed], [false, 0])
})

test('a page forgotten while its read transfers ends with it, failed or not: never asked again', async (t) => {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  let sent = 0
  t.mock.method(globalThis, 'fetch', async () => {
    sent++
    await gate
    return new Response('', { status: 503 })
  })
  const streamer = createPageStreamer([{ url: 'a.bin', bytes: 4, sha256: '' }], 'http://cache/', {
    cache: createPageCache(),
  })
  t.after(() => streamer.dispose())
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await eventually(() => sent === 1) // under way
  streamer.forget(['a.bin']) // its cell's page closed while the read is under way
  release()
  await idle(streamer)
  for (clock.now = 250; clock.now <= 2_000; clock.now += 250) {
    t.mock.timers.tick(250)
    await idle(streamer)
  }
  assert.deepEqual([sent, streamer.loading('a.bin'), streamer.stats().failed], [1, false, 0])
})

test('a failure is remembered, its tries counting on, till its key passes or its owner lets it go', (t) => {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ended: string[] = []
  const failures = createReadFailures({ retriable: () => true, ended: (key) => ended.push(key) })
  t.after(() => failures.clear())
  const step = (ms: number) => {
    clock.now += ms
    t.mock.timers.tick(ms)
  }
  assert.match(failures.record('a', 'busy').error.message, /after one attempt/)
  assert.ok(failures.blocked('a'), 'held back until the next turn of the loop')
  step(1)
  assert.deepEqual([ended, failures.blocked('a'), failures.count()], [['a'], undefined, 0])
  step(60_000) // asked again, long after: its tries are still counted
  assert.match(failures.record('a', 'busy').error.message, /after 2 attempts/)
  step(1)
  failures.passed('a')
  assert.match(failures.record('a', 'busy').error.message, /after one attempt/, 'passed: over')
  step(1)
  failures.leaves('a') // its owner lets it go
  assert.match(failures.record('a', 'busy').error.message, /after one attempt/, 'let go: over')
})
