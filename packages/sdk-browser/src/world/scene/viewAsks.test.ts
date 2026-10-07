// The view asks each url it needs with a signal of its own, frame after frame: one it stops asking
// is let go — dropped while it waits —, one it asks again is waited on till it lands.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createPageStreamer } from '../../streaming/pageStreamer.ts'
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts'
import { createViewAsks } from './viewAsks.ts'
import { sha256Hex } from '../../streaming/sha256Hex.ts'

/** A streamer of `count` pages of four zero bytes the server answers with `status` once `release`
 *  runs. */
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
    return new Response(status === 200 ? body.slice() : '', { status })
  })
  const pages = Array.from({ length: count }, (_, i) => ({ url: `p${i}.bin`, bytes: 4, sha256 }))
  const streamer = createPageStreamer(pages, 'http://cache/', { workerCount: 1 })
  t.after(() => streamer.dispose())
  return { streamer, sent, release }
}

const turns = async () => {
  for (let i = 0; i < 4; i++) await new Promise(setImmediate)
}

test('a page the next frame no longer asks is let go: waiting after a failure, it is dropped', async (t) => {
  const { streamer, release } = await served(t, 503)
  const asks = createViewAsks(streamer)
  asks.ask(['p0.bin'], PRIORITY_VISIBLE)
  asks.end()
  release()
  await turns()
  assert.equal(streamer.loading('p0.bin'), true, 'it may pass: it waits its turn')
  asks.end() // the camera turned away: this frame asks it no more
  assert.equal(streamer.loading('p0.bin'), false, 'dropped, never asked again')
})

test('a page asked again while on its way is waited on till it lands, lifted once visible', async (t) => {
  const { streamer, sent, release } = await served(t, 200, 3)
  const asks = createViewAsks(streamer)
  asks.ask(['p0.bin'], PRIORITY_VISIBLE) // the one transfer
  asks.ask(['p1.bin', 'p2.bin'], PRIORITY_PREFETCH)
  asks.end()
  await turns()
  let landed = false
  const [visible] = asks.ask(['p2.bin'], PRIORITY_VISIBLE) // turned visible
  void visible.then(() => (landed = true))
  asks.ask(['p1.bin'], PRIORITY_PREFETCH)
  asks.end()
  await turns()
  assert.equal(landed, false, 'the frame waits on it')
  release()
  await visible
  await turns()
  assert.deepEqual(sent, ['p0.bin', 'p2.bin', 'p1.bin'], 'lifted before the one still ahead')
})
