// A page streamer over a server refusing its reads, the clock and its timers in the test's hands:
// what the failure policy's tests read (`failures.test.ts`, `failureLife.test.ts`).
import type { TestContext } from 'node:test'
import { createPageStreamer, type PageStreaming } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import { eventually } from './eventually.fixture.ts'

/** Waits till `streamer` reads nothing and queues nothing: every read it was asked landed, failed
 *  or waits its turn — the events themselves, however slow the machine. */
export const idle = (streamer: PageStreaming) =>
  eventually(() => streamer.stats().loading === 0 && streamer.stats().queued === 0)

/** A streamer of the pages `urls` the server answers with `status`, the clock and its timers in
 *  the test's hands: the requests sent, when, and the failures said. */
export function refusing(t: TestContext, status: number, urls = ['a.bin'], headers?: HeadersInit) {
  const clock = { now: 0 }
  t.mock.method(performance, 'now', () => clock.now)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sent: number[] = [],
    said: string[] = []
  t.mock.method(globalThis, 'fetch', async () => {
    sent.push(clock.now)
    return new Response('', { status, headers })
  })
  const pages = urls.map((url) => ({ url, bytes: 4, sha256: '' }))
  const streamer = createPageStreamer(pages, 'http://cache/', {
    cache: createPageCache(),
    onStalled: ({ key }) => void said.push(key),
  })
  t.after(() => streamer.dispose())
  /** Its reads settled: landed, failed, or waiting their turn. */
  const settle = () => idle(streamer)
  /** The clock moved to `end` in steps of 250 ms, the timers with it, each step's reads settled
   *  before the next. */
  const until = async (end: number) => {
    for (; clock.now < end;) {
      clock.now += 250
      t.mock.timers.tick(250)
      await settle()
    }
  }
  return { streamer, sent, said, until, clock, settle }
}

/** The fingerprint a page's read checks `bytes` against. */
export async function sha(bytes: Uint8Array) {
  const { sha256Hex } = await import('./sha256Hex.ts')
  return sha256Hex(bytes.slice().buffer)
}
