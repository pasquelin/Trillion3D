// A server that ignores the Range answers the whole file: its download is shared by every range
// waiting on it, and stops only once none does. Landed, it is one entry of the page cache among
// the pages when it fits the cache's room, counted once and evicted as they are, never while a
// read waits on its download. A texture level file is read the same way, through the page cache.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createPageCache } from '../streaming/pageCache.ts'
import { createTextureLevelReader } from '../texture/levelReader.ts'
import { heldLevelsOf } from '../texture/heldLevels.ts'
import { tileRecord } from '../texture/tileRecords.ts'
import { tiledLevelBytes } from '../texture/tileRecords.fixture.ts'

const URL = 'http://cache/world.bin'

/** A server sending the whole of `file` whatever the Range, its body held until `land`, cut off
 *  by the request's signal: the signals of the requests sent. */
function wholeServer(t: TestContext, file: Uint8Array) {
  const signals: AbortSignal[] = []
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const signal = init.signal!
    signals.push(signal)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason))
        void landing.then(() => {
          if (signal.aborted) return
          controller.enqueue(file.slice())
          controller.close()
        })
      },
    })
    return new Response(body, { status: 200 })
  })
  return { signals, land }
}

test('the whole file a server sends outlives the read that asked it first: the others still read it', async (t) => {
  const { signals, land } = wholeServer(t, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  const cache = createPageCache()
  const [first, other] = [new AbortController(), new AbortController()]
  const asked = cache.readRange(URL, 0, 4, { signal: first.signal })
  const still = cache.readRange(URL, 4, 4, { signal: other.signal })
  await new Promise(setImmediate)
  first.abort()
  await assert.rejects(asked, { name: 'AbortError' })
  assert.equal(signals[0].aborted, false, 'the download goes on for the other range')
  land()
  assert.deepEqual([...new Uint8Array(await still)], [5, 6, 7, 8])
  assert.deepEqual([signals.length, cache.bytes], [1, 8], 'sent once, kept whole')
})

test('the whole download stops once no range waits on it any more', async (t) => {
  const { signals, land } = wholeServer(t, new Uint8Array(8))
  t.after(land)
  const cache = createPageCache()
  const asks = [new AbortController(), new AbortController()]
  const reads = asks.map(({ signal }, at) => cache.readRange(URL, at * 4, 4, { signal }))
  await new Promise(setImmediate)
  asks.forEach((ask) => ask.abort())
  for (const each of reads) await assert.rejects(each, { name: 'AbortError' })
  assert.deepEqual([signals[0].aborted, cache.bytes], [true, 0], 'stopped, nothing kept')
})

test('ranges asked at once before the server answered one send one request: never two whole files', async (t) => {
  const { signals, land } = wholeServer(t, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  const cache = createPageCache()
  const gone = new AbortController()
  const stopped = cache.readRange(URL, 0, 4, { signal: gone.signal })
  await new Promise(setImmediate)
  gone.abort() // the whole download stops: the next ranges ask again
  await assert.rejects(stopped, { name: 'AbortError' })
  const again = [cache.readRange(URL, 0, 4), cache.readRange(URL, 4, 4)]
  await new Promise(setImmediate)
  land()
  const [low, high] = await Promise.all(again)
  assert.deepEqual([...new Uint8Array(low), ...new Uint8Array(high)], [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual([signals.length, cache.bytes], [2, 8], 'one request after the stopped one')
})

test("a range waiting on another's first answer lets go at once when its own asker does", async (t) => {
  let answer = () => {}
  const answered = new Promise<void>((resolve) => (answer = resolve))
  t.mock.method(globalThis, 'fetch', async () => {
    await answered // the first answer, not come yet
    return new Response(new Uint8Array(8))
  })
  const cache = createPageCache()
  const first = cache.readRange(URL, 0, 4)
  const gone = new AbortController()
  const waiting = cache.readRange(URL, 4, 4, { signal: gone.signal })
  await new Promise(setImmediate)
  gone.abort()
  await assert.rejects(waiting, { name: 'AbortError' }) // before the answer
  answer()
  assert.equal((await first).byteLength, 4)
})

test('a file kept whole is one entry among the pages, counted once: it leaves by last use, and is read again after', async (t) => {
  const { signals, land } = wholeServer(
    t,
    Uint8Array.from({ length: 32 }, (_, i) => i),
  )
  land()
  const cache = createPageCache(64)
  assert.deepEqual([...new Uint8Array(await cache.readRange(URL, 0, 4))], [0, 1, 2, 3])
  assert.deepEqual([cache.bytes, cache.file(URL)?.byteLength], [32, 32])
  cache.put('page.bin', new Uint8Array(48)) // used after the file
  cache.resize(64)
  assert.deepEqual([cache.bytes, cache.file(URL), cache.pageCount], [48, undefined, 1])
  assert.deepEqual([...new Uint8Array(await cache.readRange(URL, 4, 4))], [4, 5, 6, 7])
  assert.deepEqual(
    [signals.length, cache.bytes, cache.page('page.bin')],
    [2, 32, undefined],
    'asked again, the file is the most recent: the page leaves for it',
  )
})

test('no eviction takes a download a read waits on: the read is served, the file then leaves by the budget', async (t) => {
  const { signals, land } = wholeServer(
    t,
    Uint8Array.from({ length: 32 }, (_, i) => i),
  )
  const cache = createPageCache(64)
  const waiting = cache.readRange(URL, 4, 4)
  await new Promise(setImmediate)
  cache.resize(16) // the file on its way would not fit
  assert.equal(signals[0].aborted, false, 'its download goes on')
  land()
  assert.deepEqual([...new Uint8Array(await waiting)], [4, 5, 6, 7])
  assert.deepEqual([signals.length, cache.bytes], [1, 0], 'served, it leaves: it does not fit')
})

test('a whole file past the room serves every range waiting on it and is let go: no entry leaves for it', async (t) => {
  const { signals, land } = wholeServer(
    t,
    Uint8Array.from({ length: 80 }, (_, i) => i),
  )
  const cache = createPageCache(64)
  cache.put('page.bin', new Uint8Array(16))
  const waiting = [cache.readRange(URL, 0, 4), cache.readRange(URL, 76, 4)]
  await new Promise(setImmediate)
  land()
  const [low, high] = await Promise.all(waiting)
  assert.deepEqual([...new Uint8Array(low), ...new Uint8Array(high)], [0, 1, 2, 3, 76, 77, 78, 79])
  assert.deepEqual(
    [signals.length, cache.bytes, cache.file(URL), cache.pageCount],
    [1, 16, undefined, 1],
    'sent once, not kept: the page stays',
  )
})

test('a texture level a server sends whole is sent once, every tile record cut from it, its bytes counted once', async (t) => {
  const file = Uint8Array.from({ length: tiledLevelBytes(256, 256) }, (_, i) => (i * 13) & 255)
  const sent: (string | null)[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get('range'))
    return new Response(file.slice(), { status: 200 })
  })
  globalThis.createImageBitmap ??= (() => Promise.reject(new Error('unused'))) as never
  const cache = createPageCache()
  const textures = { url: '{sha}/{kind}-{level}.{format}', version: 6 }
  const read = createTextureLevelReader({ textures, key: 'k' }, 'https://host/', cache)!
  const levels = heldLevelsOf(read)
  const level = { sha256: 'c'.repeat(64), atlas: 0, level: 0, format: 'bc7' } as const
  const tiles = [0, 1, 2, 3].map((i) => [i & 1, i >> 1] as const)
  const ask = (tx: number, ty: number) => levels.read(level, [256, 256], assert.fail, tx, ty)
  for (const [tx, ty] of tiles) ask(tx, ty)
  await levels.settled()
  assert.equal(sent.length, 1, 'one request: the others waited for its answer')
  for (const [tx, ty] of tiles) {
    const { offset, bytes } = tileRecord(256, 256, tx, ty)
    assert.deepEqual(ask(tx, ty), file.subarray(offset, offset + bytes))
  }
  // The file and the records are entries of the one cache: each counted once.
  assert.deepEqual([cache.bytes, cache.levelBytes], [2 * file.byteLength, file.byteLength])
})
