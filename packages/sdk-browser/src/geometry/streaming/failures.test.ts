// A read that failed, whatever the failure, is asked again at once, as many times as its owner's
// tries allow, then given up; a refusal that asks a wait (Retry-After) waits it. No timer serves a
// wait of 0; the waits a server asked are one heap and one timer, whatever the failures; a failure
// is said at its first failure in a row and when its key is given up.
import test from 'node:test'
import assert from 'node:assert/strict'
import { refusing, sha } from './failures.fixture.ts'

test('a read that failed is asked again at once, with no wait, as many times as its tries allow, then given up', async (t) => {
  const { streamer, sent, said, until, settle } = refusing(t, 503, ['a.bin'], undefined, 3)
  const read = streamer.request(['a.bin'], { signal: streamer.signal })
  const failed = assert.rejects(read, /PAGE_STREAM_FAILED.*after 4 attempts/)
  await settle()
  assert.deepEqual(
    sent,
    [0, 0, 0, 0],
    'the first request and its three tries, all before any time passed',
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

test('an owner that gives no count has the default tries: three, then given up', async (t) => {
  const { streamer, sent, said, settle } = refusing(t, 503)
  await assert.rejects(streamer.request(['a.bin'], { signal: streamer.signal }), /after 4 attempts/)
  await settle()
  assert.deepEqual([sent.length, said], [4, ['a.bin', 'a.bin']])
})

test('a negative count tries without end: a read waiting on its server’s Retry-After is asked again each time, its asker still waiting, said once', async (t) => {
  const { streamer, sent, said, until, settle } = refusing(
    t,
    503,
    ['a.bin'],
    { 'retry-after': '1' },
    -1,
  )
  let settled = false
  void streamer.request(['a.bin'], { signal: streamer.signal }).then(
    () => (settled = true),
    () => (settled = true),
  )
  await settle()
  await until(10_000)
  assert.ok(sent.length >= 10, `${sent.length} requests`)
  assert.deepEqual(said, ['a.bin'], 'said at its first failure alone')
  assert.deepEqual([settled, streamer.loading('a.bin')], [false, true])
})

test('a read that failed lands once its source answers: its asker never told it failed', async (t) => {
  const { streamer, until, settle } = refusing(t, 503, ['a.bin'], { 'retry-after': '1' }, -1)
  const bytes = new Uint8Array([7, 0, 0, 0])
  const read = streamer.readBytes('a.bin', streamer.signal)
  await settle()
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: await sha(bytes) }])
  await until(1_500)
  assert.deepEqual([...(await read)], [7, 0, 0, 0])
  assert.equal(streamer.stats().failed, 0, 'its failures in a row are over')
})

test('a read the server does not hold (404) is asked again as any failed read, its three tries, then given up, said twice', async (t) => {
  const { streamer, sent, said, until } = refusing(t, 404)
  await assert.rejects(
    streamer.request(['a.bin'], { signal: streamer.signal }),
    /PAGE_STREAM_FAILED.*after 4 attempts/,
  )
  await until(10_000)
  await assert.rejects(
    streamer.request(['a.bin'], { signal: streamer.signal }),
    /PAGE_STREAM_FAILED/,
  )
  assert.deepEqual([sent, said, streamer.failed('a.bin')], [[0, 0, 0, 0], ['a.bin', 'a.bin'], true])
})

test('a read waiting its turn whose last asker lets go is dropped: never asked again', async (t) => {
  const { streamer, sent, until, settle } = refusing(t, 503, ['a.bin'], { 'retry-after': '5' }, -1)
  const leaving = new AbortController()
  const read = streamer.readBytes('a.bin', leaving.signal)
  await settle()
  leaving.abort()
  await assert.rejects(read, { name: 'AbortError' })
  await until(10_000)
  assert.deepEqual([sent, streamer.loading('a.bin')], [[0], false])
})

test('thirty thousand failed reads set no timer: each asked again at once', async (t) => {
  const urls = Array.from({ length: 30_000 }, (_, i) => `p${i}.bin`)
  const { streamer, sent, settle } = refusing(t, 503, urls, undefined, 1)
  const armed = t.mock.method(globalThis, 'setTimeout')
  void streamer.request(urls, { signal: streamer.signal }).catch(() => {})
  await settle()
  assert.deepEqual([sent.length, streamer.stats().failed], [2 * urls.length, urls.length])
  assert.equal(armed.mock.callCount(), 0, 'no timer: a wait of 0 is none')
})

test('thirty thousand reads whose server asked a wait share one timer', async (t) => {
  const urls = Array.from({ length: 30_000 }, (_, i) => `p${i}.bin`)
  const { streamer, sent, until, settle } = refusing(t, 503, urls, { 'retry-after': '1' }, 1)
  const armed = t.mock.method(globalThis, 'setTimeout')
  void streamer.request(urls, { signal: streamer.signal }).catch(() => {})
  await settle()
  assert.deepEqual([sent.length, streamer.stats().failed], [urls.length, urls.length])
  assert.equal(armed.mock.callCount(), 1, 'one timer, set for the first wait')
  await until(1_250)
  assert.equal(sent.length, 2 * urls.length, 'each asked again once its wait ended')
})

test('a refusal that asks a wait (Retry-After) waits at least that long', async (t) => {
  const { streamer, sent, until, settle } = refusing(t, 429, ['a.bin'], { 'retry-after': '3' })
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  await until(4_000)
  assert.deepEqual(sent, [0, 3000], 'asked again once the server said, not at once')
})

test('a refusal asking a wait on every attempt is said once, not once an attempt', async (t) => {
  const { streamer, said, until, settle } = refusing(t, 503, ['a.bin'], { 'retry-after': '9' }, -1)
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  await until(60_000)
  assert.deepEqual(said, ['a.bin'])
})

test('a failure is said at its first failure, and again only once its page landed and fails anew', async (t) => {
  const { streamer, said, until, settle } = refusing(t, 503, ['a.bin'], { 'retry-after': '1' }, -1)
  const first = streamer.request(['a.bin'], { signal: streamer.signal })
  await settle()
  await until(2_000)
  assert.deepEqual(said, ['a.bin'], 'said at its first failure, not once a try')
  const bytes = new Uint8Array([7, 0, 0, 0])
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes))
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: await sha(bytes) }])
  await until(3_250) // it is asked again when its wait ends
  await first // and lands, its bytes checked off the clock the test moves
  assert.equal(streamer.has('a.bin'), true, 'landed: its failures in a row are over')
  streamer.forget(['a.bin'])
  streamer.admit([{ url: 'a.bin', bytes: 4, sha256: 'other' }])
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 503, headers: { 'retry-after': '1' } }),
  )
  void streamer.request(['a.bin'], { signal: streamer.signal }).catch(() => {})
  await settle()
  await until(4_500)
  assert.deepEqual(said, ['a.bin', 'a.bin'], 'fails anew: said again')
})
