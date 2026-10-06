// A read that failed and may pass waits, twice as long each time up to 8 s, refused at once
// meanwhile; one that never passes (a 404) is refused for good, while its page is catalogued.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from './pageStreamer.ts'
import { finalFailure } from './failures.ts'

/** A streamer of one page the server answers with `status`, the clock and its timers in the
 *  test's hands: the requests sent and the failures said. */
function refusing(t: TestContext, status: number) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: number[] = [],
    said: string[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sent.push(clock.now)
    return new Response('', { status })
  })
  const streamer = createPageStreamer([{ url: 'a.bin', bytes: 4, sha256: '' }], 'http://cache/', {
    onStalled: ({ url }) => void said.push(url),
  })
  /** A frame every 250 ms until `end`, each asking the page. */
  const frames = async (end: number) => {
    for (; clock.now <= end; clock.now += 250, t.mock.timers.tick(250))
      await streamer.request(['a.bin']).catch(() => {})
  }
  return { streamer, sent, said, frames, clock }
}

test('a read that may pass waits 0.5 s · 2^k up to 8 s, refused at once meanwhile', async (t) => {
  const { streamer, sent, said, frames } = refusing(t, 503)
  try {
    await frames(24_000)
    const reads = [...new Set(sent)] // three attempts a read
    assert.deepEqual(reads, [0, 500, 1500, 3500, 7500, 15500, 23500])
    assert.deepEqual(said, ['a.bin'], 'said once, as it first waits 8 s')
    assert.equal(streamer.stats().failed, 1)
  } finally {
    streamer.dispose()
  }
})

test('a read another request would meet again (404) is refused for good, and said once', async (t) => {
  const { streamer, sent, said, frames } = refusing(t, 404)
  try {
    await frames(10_000)
    assert.deepEqual([sent, said], [[0], ['a.bin']])
    assert.equal(streamer.failed('a.bin'), true)
  } finally {
    streamer.dispose()
  }
})

test('a page is `failed` only while its refusal is in force: once its wait is over it is asked again', async (t) => {
  const { streamer, sent, frames, clock } = refusing(t, 503)
  try {
    await frames(0) // read and refused at 0, its wait running till 500
    assert.equal(streamer.failed('a.bin'), true, 'refused at once during its wait')
    clock.now = 500
    assert.equal(streamer.failed('a.bin'), false, 'its wait over, the view may ask it')
    await streamer.request(['a.bin']).catch(() => {})
    assert.deepEqual([...new Set(sent)], [0, 500], 'asked again')
  } finally {
    streamer.dispose()
  }
})

test('the failed reads a streamer counts are those refused now: one whose wait is over is not', async (t) => {
  const { streamer, frames, clock } = refusing(t, 503)
  try {
    await frames(0) // read and refused at 0, its wait running till 500
    assert.equal(streamer.stats().failed, 1)
    clock.now = 500
    t.mock.timers.tick(500)
    await new Promise(setImmediate)
    assert.equal(streamer.stats().failed, 0, 'its wait over, it may be asked')
  } finally {
    streamer.dispose()
  }
})

test('a failure outlives its page while its wait runs, then leaves; one for good leaves with it', async (t) => {
  const { streamer, sent, frames, clock } = refusing(t, 503)
  const page = { url: 'a.bin', bytes: 4, sha256: '' }
  try {
    await frames(0) // refused at 0 till 500
    streamer.forget(['a.bin'])
    streamer.admit([page])
    await streamer.request(['a.bin']).catch(() => {})
    assert.deepEqual(sent.length, 3, 'admitted again within its wait: still refused')
    streamer.forget(['a.bin'])
    clock.now = 500
    t.mock.timers.tick(500)
    await new Promise(setImmediate)
    assert.equal(streamer.stats().failed, 0, 'its wait over, its page gone: it leaves')
    streamer.admit([page])
    await streamer.request(['a.bin']).catch(() => {})
    clock.now = 1000
    assert.equal(streamer.failed('a.bin'), false, 'a first failure again: half a second')
  } finally {
    streamer.dispose()
  }
})

test('a refusal for good leaves with its page: nothing asks it any more', async (t) => {
  const { streamer, frames } = refusing(t, 404)
  try {
    await frames(0)
    assert.deepEqual([streamer.failed('a.bin'), streamer.stats().failed], [true, 1])
    streamer.forget(['a.bin'])
    assert.deepEqual([streamer.failed('a.bin'), streamer.stats().failed], [false, 0])
  } finally {
    streamer.dispose()
  }
})

test('a failure is final when refused for good or past the longest wait, else the read waits', () => {
  const refusal = (due: number, stalled: boolean) => Object.assign(new Error(), { due, stalled })
  assert.equal(finalFailure(refusal(500, false)), false, 'it waits, then is asked again')
  assert.equal(finalFailure(refusal(Infinity, true)), true, 'a 404')
  assert.equal(finalFailure(refusal(8000, true)), true, 'past the longest wait')
  assert.equal(finalFailure(new Error('a file that does not decode')), true)
})
