// A read that failed and may pass waits, twice as long each time up to 8 s, one request a wait,
// its askers still waiting on it; one that never passes (a 404) is refused for good while its page
// is catalogued. The waits are one heap and one timer, whatever the failures.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from './pageStreamer.ts'

/** Lets the queue's tasks run: its pump, the request, the failure's record. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate)
}

/** A streamer of the pages `urls` the server answers with `status`, the clock and its timers in
 *  the test's hands: the requests sent, when, and the failures said. */
function refusing(t: TestContext, status: number, urls = ['a.bin']) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: number[] = [],
    said: string[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sent.push(clock.now)
    return new Response('', { status })
  })
  const pages = urls.map((url) => ({ url, bytes: 4, sha256: '' }))
  const streamer = createPageStreamer(pages, 'http://cache/', {
    onStalled: ({ url }) => void said.push(url),
  })
  t.after(() => streamer.dispose())
  /** The clock moved to `end` in steps of 250 ms, the timers with it. */
  const until = async (end: number) => {
    for (; clock.now < end;) {
      clock.now += 250
      t.mock.timers.tick(250)
      await settle()
    }
  }
  return { streamer, sent, said, until, clock }
}

test('a read that may pass is asked once a wait, 0.5 s · 2^k up to 8 s, its asker still waiting', async (t) => {
  const { streamer, sent, said, until } = refusing(t, 503)
  let settled = false
  void streamer.request(['a.bin']).then(
    () => (settled = true),
    () => (settled = true),
  )
  await settle()
  await until(24_000)
  assert.deepEqual(sent, [0, 500, 1500, 3500, 7500, 15500, 23500], 'one request a wait')
  assert.deepEqual(said, ['a.bin'], 'said once, as it first waits 8 s')
  assert.deepEqual([settled, streamer.loading('a.bin'), streamer.stats().failed], [false, true, 1])
})

test('a read that may pass lands once its source answers: its asker never told it failed', async (t) => {
  const { streamer, until } = refusing(t, 503)
  const bytes = new Uint8Array([7, 0, 0, 0])
  const read = streamer.readBytes('a.bin')
  await settle()
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: await sha(bytes) }])
  await until(500)
  assert.deepEqual([...(await read)], [7, 0, 0, 0])
  assert.equal(streamer.stats().failed, 0, 'its failures in a row are over')
})

test('a read another request would meet again (404) fails for good, said once, never asked again', async (t) => {
  const { streamer, sent, said, until } = refusing(t, 404)
  await assert.rejects(streamer.request(['a.bin']), /PAGE_STREAM_FAILED.*after one attempt/)
  await until(10_000)
  await assert.rejects(streamer.request(['a.bin']), /PAGE_STREAM_FAILED/)
  assert.deepEqual([sent, said, streamer.failed('a.bin')], [[0], ['a.bin'], true])
})

test('a read waiting its turn whose last asker lets go is dropped: never asked again', async (t) => {
  const { streamer, sent, until } = refusing(t, 503)
  const leaving = new AbortController()
  const read = streamer.readBytes('a.bin', leaving.signal)
  await settle()
  leaving.abort()
  await assert.rejects(read, { name: 'AbortError' })
  await until(2_000)
  assert.deepEqual([sent, streamer.loading('a.bin')], [[0], false])
})

test('a failure outlives its page while its wait runs, then leaves; one for good leaves with it', async (t) => {
  const { streamer, sent, until, clock } = refusing(t, 503)
  const page = { url: 'a.bin', bytes: 4, sha256: '' }
  const leaving = new AbortController()
  void streamer.readBytes('a.bin', leaving.signal).catch(() => {})
  await settle()
  leaving.abort()
  streamer.forget(['a.bin'])
  streamer.admit([page])
  void streamer.request(['a.bin']).catch(() => {})
  await settle()
  assert.deepEqual(sent, [0], 'admitted again within its wait: it waits it out')
  await until(500)
  assert.deepEqual(sent, [0, 500], 'asked once its wait ended')
  assert.equal(clock.now, 500)
})

test('a refusal for good leaves with its page: nothing asks it any more', async (t) => {
  const { streamer } = refusing(t, 404)
  await streamer.request(['a.bin']).catch(() => {})
  assert.deepEqual([streamer.failed('a.bin'), streamer.stats().failed], [true, 1])
  streamer.forget(['a.bin'])
  assert.deepEqual([streamer.failed('a.bin'), streamer.stats().failed], [false, 0])
})

test('a hundred thousand failed reads wait on one timer, each asked once a wait', async (t) => {
  const urls = Array.from({ length: 100_000 }, (_, i) => `p${i}.bin`)
  const { streamer, sent, until } = refusing(t, 503, urls)
  const armed = t.mock.method(globalThis, 'setTimeout')
  void streamer.request(urls).catch(() => {})
  await settle()
  for (let i = 0; i < 200 && sent.length < urls.length; i++) await settle()
  assert.deepEqual([sent.length, streamer.stats().failed], [urls.length, urls.length])
  assert.equal(armed.mock.callCount(), 1, 'one timer, set for the first wait')
  await until(500)
  for (let i = 0; i < 200 && sent.length < 2 * urls.length; i++) await settle()
  assert.equal(sent.length, 2 * urls.length, 'each asked again once its wait ended')
})

async function sha(bytes: Uint8Array) {
  const { sha256Hex } = await import('./sha256Hex.ts')
  return sha256Hex(bytes.slice().buffer)
}
