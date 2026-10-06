// A server that ignores the Range answers the whole file: its download is the reader's, shared by
// every range waiting on it, and stops only once none does.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { rangedReader } from './ranged.ts'

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
  const read = rangedReader('http://cache/world.bin')
  const [first, other] = [new AbortController(), new AbortController()]
  const asked = read(0, 4, { signal: first.signal })
  const still = read(4, 4, { signal: other.signal })
  await new Promise(setImmediate)
  first.abort()
  await assert.rejects(asked, { name: 'AbortError' })
  assert.equal(signals[0].aborted, false, 'the download goes on for the other range')
  land()
  assert.deepEqual([...new Uint8Array(await still)], [5, 6, 7, 8])
  assert.deepEqual([signals.length, read.held()], [1, 8], 'sent once, kept whole')
})

test('the whole download stops once no range waits on it any more', async (t) => {
  const { signals, land } = wholeServer(t, new Uint8Array(8))
  t.after(land)
  const read = rangedReader('http://cache/world.bin')
  const asks = [new AbortController(), new AbortController()]
  const reads = asks.map(({ signal }, at) => read(at * 4, 4, { signal }))
  await new Promise(setImmediate)
  asks.forEach((ask) => ask.abort())
  for (const each of reads) await assert.rejects(each, { name: 'AbortError' })
  assert.equal(signals[0].aborted, true)
})

test('ranges asked at once before the server answered one send one request: never two whole files', async (t) => {
  const { signals, land } = wholeServer(t, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  const read = rangedReader('http://cache/world.bin')
  const gone = new AbortController()
  const stopped = read(0, 4, { signal: gone.signal })
  await new Promise(setImmediate)
  gone.abort() // the whole download stops: the next ranges ask again
  await assert.rejects(stopped, { name: 'AbortError' })
  const again = [read(0, 4), read(4, 4)]
  await new Promise(setImmediate)
  land()
  const [low, high] = await Promise.all(again)
  assert.deepEqual([...new Uint8Array(low), ...new Uint8Array(high)], [1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual([signals.length, read.held()], [2, 8], 'one request after the stopped one')
})
