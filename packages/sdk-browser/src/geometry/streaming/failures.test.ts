// A read that failed and may pass is asked again at once, as many times as its owner's tries allow,
// then given up; a refusal that asks a wait (Retry-After) waits it; one that never passes (a 404) is
// refused for good. The waits are one heap and one timer, whatever the failures; a failure is said
// at its first failure in a row and when its key is given up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { refusing, sha } from './failures.fixture.ts'

test('a read that may pass is asked again at once, with no wait, as many times as its tries allow, then given up', async (t) => {
  const { streamer, sent, said, until, settle } = refusing(t, 503, ['a.bin'], undefined, 3)
  const read = streamer.request(['a.bin'], { signal: streamer.signal })
  const failed = assert.rejects(read, /PAGE_STREAM_FAILED.*after 4 attempts/)
  await settle()
  assert.deepEqual(sent, [0], 'asked, and failed')
  await until(1_000)
  assert.deepEqual(
    sent,
    [0, 250, 500, 750],
    'the first request and its three tries, one turn of the loop each',
  )
  await failed
  assert.deepEqual(
    [streamer.failed('a.bin'), said],
    [true, ['a.bin', 'a.bin']],
    'given up, said at the first failure and when given up',
  )
  await until(5_000)
  assert.equal(sent.length, 4, 'never asked again')
})

test('a read whose owner sets no limit is asked again at every turn, its asker still waiting, said once', async (t) => {
  const { streamer, sent, said, until, settle } = refusing(t, 503)
  let settled = false
  void streamer.request(['a.bin'], { signal: streamer.signal }).then(
    () => (settled = true),
    () => (settled = true),
  )
  await settle()
  await until(1_000)
  assert.ok(sent.length >= 4, `${sent.length} requests, none held back`)
  assert.deepEqual(said, ['a.bin'], 'said at its first failure alone')
  assert.deepEqual([settled, streamer.loading('a.bin')], [false, true])
})

test('a read that may pass lands once its source answers: its asker never told it failed', async (t) => {
  const { streamer, until, settle } = refusing(t, 503)
  const bytes = new Uint8Array([7, 0, 0, 0])
  const read = streamer.readBytes('a.bin', streamer.signal)
  await settle()
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: await sha(bytes) }])
  await until(500)
  assert.deepEqual([...(await read)], [7, 0, 0, 0])
  assert.equal(streamer.stats().failed, 0, 'its failures in a row are over')
})

test('a read another request would meet again (404) fails for good, said once, never asked again', async (t) => {
  const { streamer, sent, said, until } = refusing(t, 404)
  await assert.rejects(
    streamer.request(['a.bin'], { signal: streamer.signal }),
    /PAGE_STREAM_FAILED.*after one attempt/,
  )
  await until(10_000)
  await assert.rejects(
    streamer.request(['a.bin'], { signal: streamer.signal }),
    /PAGE_STREAM_FAILED/,
  )
  assert.deepEqual([sent, said, streamer.failed('a.bin')], [[0], ['a.bin'], true])
})

test('a read waiting its turn whose last asker lets go is dropped: never asked again', async (t) => {
  const { streamer, sent, until, settle } = refusing(t, 503)
  const leaving = new AbortController()
  const read = streamer.readBytes('a.bin', leaving.signal)
  await settle()
  leaving.abort()
  await assert.rejects(read, { name: 'AbortError' })
  await until(2_000)
  assert.deepEqual([sent, streamer.loading('a.bin')], [[0], false])
})

test('a hundred thousand failed reads wait on one timer, each asked again at the next turn', async (t) => {
  const urls = Array.from({ length: 100_000 }, (_, i) => `p${i}.bin`)
  const { streamer, sent, until, settle } = refusing(t, 503, urls)
  const armed = t.mock.method(globalThis, 'setTimeout')
  void streamer.request(urls, { signal: streamer.signal }).catch(() => {})
  await settle()
  assert.deepEqual([sent.length, streamer.stats().failed], [urls.length, urls.length])
  assert.equal(armed.mock.callCount(), 1, 'one timer, set for the first wait')
  await until(250)
  assert.ok(sent.length >= 2 * urls.length, 'each asked again once its turn came')
})

test('a refusal that asks a wait (Retry-After) waits at least that long', async (t) => {
  const { streamer, sent, until, settle } = refusing(t, 429, ['a.bin'], { 'retry-after': '3' })
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  await until(4_000)
  assert.deepEqual(sent, [0, 3000], 'asked again once the server said, not after half a second')
})

test('a refusal asking a wait on every attempt is said once, not once an attempt', async (t) => {
  const { streamer, said, until, settle } = refusing(t, 503, ['a.bin'], { 'retry-after': '9' })
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  await until(60_000)
  assert.deepEqual(said, ['a.bin'])
})

test('a failure is said at its first failure, and again only once its page landed and fails anew', async (t) => {
  const { streamer, said, until, settle } = refusing(t, 503)
  const first = streamer.request(['a.bin'], { signal: streamer.signal })
  await settle()
  await until(2_000)
  assert.deepEqual(said, ['a.bin'], 'said at its first failure, not once a try')
  const bytes = new Uint8Array([7, 0, 0, 0])
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: await sha(bytes) }])
  await until(2_250) // it is asked again at the next turn
  await first // and lands, its bytes checked off the clock the test moves
  assert.equal(streamer.has('a.bin'), true, 'landed: its failures in a row are over')
  streamer.forget(['a.bin'])
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: 'other' }])
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  await until(2_500)
  assert.deepEqual(said, ['a.bin', 'a.bin'], 'fails anew: said again')
})
