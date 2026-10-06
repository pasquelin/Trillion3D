// A read that failed and may pass waits its turn, twice as long each time up to 8 s, refused at once
// meanwhile; one that never passes (a 404) is refused for good.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from './pageStreamer.ts'

/** A streamer of one page the server answers with `status`, the clock and its timers in the test's
 *  hands: the requests sent, the turns told and the failures said. */
function refusing(t: TestContext, status: number) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: number[] = [],
    turns: number[] = [],
    said: string[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sent.push(clock.now)
    return new Response('', { status })
  })
  const streamer = createPageStreamer([{ url: 'a.bin', bytes: 4, sha256: '' }], 'http://cache/', {
    onTurn: () => void turns.push(clock.now),
    onStalled: ({ url }) => void said.push(url),
  })
  /** A frame every 250 ms until `end`, each asking the page. */
  const frames = async (end: number) => {
    for (; clock.now <= end; clock.now += 250, t.mock.timers.tick(250))
      await streamer.request(['a.bin']).catch(() => {})
  }
  return { streamer, sent, turns, said, frames, clock }
}

test('a read that may pass waits 0.5 s · 2^k up to 8 s, refused at once meanwhile, its turn told', async (t) => {
  const { streamer, sent, turns, said, frames } = refusing(t, 503)
  try {
    await frames(24_000)
    const reads = [...new Set(sent)] // three attempts a read
    assert.deepEqual(reads, [0, 500, 1500, 3500, 7500, 15500, 23500])
    assert.deepEqual(turns, reads.slice(1), 'each wait over is told: the view asks again')
    assert.deepEqual(said, ['a.bin'], 'said once, as it first waits 8 s')
    assert.equal(streamer.stats().failed, 1)
  } finally {
    streamer.dispose()
  }
})

test('a read another request would meet again (404) is refused for good, its turn never told', async (t) => {
  const { streamer, sent, turns, frames } = refusing(t, 404)
  try {
    await frames(10_000)
    assert.deepEqual([sent, turns], [[0], []])
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
    t.mock.timers.tick(250)
    assert.equal(streamer.failed('a.bin'), false, 'its wait over, the view may ask it')
    await streamer.request(['a.bin']).catch(() => {})
    assert.deepEqual([...new Set(sent)], [0, 500], 'asked again')
  } finally {
    streamer.dispose()
  }
})

test('a read is asked again once its turn is told, even on a clock still short of its wait', async (t) => {
  const { streamer, sent, frames, clock } = refusing(t, 503)
  try {
    await frames(0) // read and refused at 0, its wait running till 500
    clock.now = 499
    t.mock.timers.tick(500) // its turn told a hair before the clock reads 500
    await new Promise(setImmediate)
    assert.equal(streamer.failed('a.bin'), false, 'its turn told, it is asked again')
    await streamer.request(['a.bin']).catch(() => {})
    assert.deepEqual([...new Set(sent)], [0, 499])
  } finally {
    streamer.dispose()
  }
})
