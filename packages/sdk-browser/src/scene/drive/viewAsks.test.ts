// The view asks each url it needs with a signal of its own, frame after frame: one it stops asking
// is let go — dropped while it waits —, one it asks again is waited on till it lands.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { eventually } from '../../geometry/streaming/eventually.fixture.ts'
import { createPageStreamer } from '../../geometry/streaming/pageStreamer.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { createViewAsks } from './viewAsks.ts'
import { sha256Hex } from '../../geometry/streaming/sha256Hex.ts'

/** A streamer of `count` pages of four zero bytes the server answers with `status` once `release`
 *  runs; a 503 asks a long wait (`Retry-After`), so the page waits its turn. */
async function served(t: TestContext, status: number, count = 1) {
  const body = new Uint8Array(4),
    sha256 = await sha256Hex(body.slice().buffer)
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  t.after(release)
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    sent.push(String(url).split('/').at(-1)!)
    await gate
    const headers = status === 503 ? { 'retry-after': '60' } : undefined
    return new Response(status === 200 ? body.slice() : '', { status, headers })
  })
  const pages = Array.from({ length: count }, (_, i) => ({ url: `p${i}.bin`, bytes: 4, sha256 }))
  const streamer = createPageStreamer(pages, 'http://cache/', {
    cache: createPageCache(),
    workerCount: 1,
  })
  t.after(() => streamer.dispose())
  return { streamer, sent, release }
}

const turns = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate)
}

test('a page the next frame no longer asks is let go: waiting after a failure, it is dropped', async (t) => {
  const { streamer, release } = await served(t, 503)
  const asks = createViewAsks(streamer)
  asks.ask(['p0.bin'])
  asks.end()
  release()
  await eventually(() => streamer.stats().failed === 1)
  assert.equal(streamer.loading('p0.bin'), true, 'its server asked a wait: it waits its turn')
  asks.end() // the camera turned away: this frame asks it no more
  assert.equal(streamer.loading('p0.bin'), false, 'dropped, never asked again')
})

test('a page asked again while on its way is waited on till it lands, read once', async (t) => {
  const { streamer, sent, release } = await served(t, 200, 2)
  const asks = createViewAsks(streamer)
  asks.ask(['p0.bin']) // the one transfer
  asks.ask(['p1.bin'])
  asks.end()
  await eventually(() => sent.length === 1) // p0 under way, p1 queued
  let landed = false
  const [again] = asks.ask(['p1.bin']) // asked again
  void again.then(() => (landed = true))
  asks.end()
  await turns()
  assert.equal(landed, false, 'the frame waits on it')
  release()
  await again
  await eventually(() => sent.length === 2)
  assert.deepEqual(sent, ['p0.bin', 'p1.bin'], 'each read once')
})

test('a page asked holds one pin while the frames ask it, and none once it left the plan', () => {
  const pinned = new Map<string, number>()
  const asks = createViewAsks({
    readBytes: () => new Promise<Uint8Array>(() => {}),
    pin: (url) => void pinned.set(url, (pinned.get(url) ?? 0) + 1),
    unpin: (url) => void pinned.set(url, pinned.get(url)! - 1),
  })
  asks.ask(['a', 'b'])
  asks.end()
  asks.ask(['a']) // asked again: still one pin
  asks.end()
  assert.deepEqual(Object.fromEntries(pinned), { a: 1, b: 0 }, 'b left the plan')
  asks.drop(new Error('closed'))
  assert.deepEqual(Object.fromEntries(pinned), { a: 0, b: 0 }, 'closed: none pinned')
})
