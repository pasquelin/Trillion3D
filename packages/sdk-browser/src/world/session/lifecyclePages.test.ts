import test from 'node:test'
import assert from 'node:assert/strict'
import type { JobProgress } from '../../../../sdk-core/src/index.ts'
import { sha256Hex } from '../../streaming/sha256Hex.ts'
import { createPageStreamer } from '../../streaming/pageStreamer.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { createExplorerLifecycle } from './lifecycle.ts'

type Session = Parameters<typeof createExplorerLifecycle>[0]
type Inputs = Parameters<typeof createExplorerLifecycle>[1]

/** A session whose engine lacks `missing` until they are handed to it, and whose view pins
 *  `pinned` besides, over a real streamer of three verified pages that holds `resident` already. */
async function lackingPages(missing: string[], pinned: string[] = [], resident = pinned) {
  const bytes = new Uint8Array([1, 0, 0, 0])
  const sha256 = await sha256Hex(bytes.buffer)
  globalThis.fetch = async () => new Response(bytes, { status: 200 })
  const pages = ['a.bin', 'b.bin', 'c.bin'].map((url) => ({ url, bytes: 4, sha256 }))
  const streamer = createPageStreamer(pages, 'http://cache/')
  await streamer.request(resident)
  const accepted: string[] = []
  const backend = {
    render() {},
    pendingUrls: () => missing.filter((url) => !accepted.includes(url)),
    // The view's pins, a fresh table each read: the streamer takes the whole membership.
    retainedRanks: () => {
      const urls = [...pinned, ...missing]
      const held = Int32Array.from(urls.keys())
      const none = new Int32Array(0)
      const count = urls.length
      return {
        urls,
        entered: held,
        enteredCount: count,
        exited: none,
        exitedCount: 0,
        held,
        heldCount: count,
      }
    },
    acceptPage: (url: string) => void accepted.push(url),
    syncResident() {},
    // Every engine reads its cut back in a flush; this one reads no page there itself.
    flush: async () => {},
  }
  const inputs = {
    check() {},
    state: {},
    streamer,
    streaming: {},
    engine: backend,
    camera: G.perspectiveCamera(),
  } as unknown as Inputs
  const session = { scope: 'slice' } as unknown as Session
  return { lifecycle: createExplorerLifecycle(session, inputs), accepted, streamer, backend }
}

test('awaitPages reports each page the view lacked as it lands, then completed === total', async () => {
  const { lifecycle, accepted, streamer } = await lackingPages(['a.bin', 'b.bin'])
  const heard: JobProgress[] = []
  await lifecycle.awaitPages({ image: false, onProgress: (event) => heard.push(event) })
  assert.deepEqual(accepted.sort(), ['a.bin', 'b.bin'])
  assert.ok(heard.every((event) => event.phase === 'pages'))
  assert.deepEqual(
    heard.map(({ completed, total }) => [completed, total]),
    [
      [0, 2],
      [1, 2],
      [2, 2],
    ],
  )
  streamer.dispose()
})

test('awaitPages counts the pages the streamer reads: once each, only those it holds', async () => {
  const { lifecycle, streamer } = await lackingPages(['a.bin', 'a.bin', 'unknown.bin', 'b.bin'])
  const heard: JobProgress[] = []
  await lifecycle.awaitPages({ onProgress: (event) => heard.push(event) })
  assert.deepEqual(
    heard.map(({ completed, total }) => [completed, total]),
    [
      [0, 2],
      [1, 2],
      [2, 2],
    ],
    'the total is what the streamer requests, reached without a jump',
  )
  streamer.dispose()
})

test('awaitPages with every page resident still closes its count', async () => {
  const { lifecycle, streamer } = await lackingPages([])
  const heard: JobProgress[] = []
  await lifecycle.awaitPages({ onProgress: (event) => heard.push(event) })
  assert.deepEqual(
    heard.map(({ phase, completed, total }) => [phase, completed, total]),
    [['pages', 0, 0]],
  )
  streamer.dispose()
})

const held = [
  // Frames drawn before the wait may have read every page but one: never 0 of 0 on a drawn view.
  {
    name: 'counts the pages the view already holds',
    resident: ['a.bin', 'c.bin'],
    heard: [
      [2, 3],
      [3, 3],
    ],
  },
  // Past the page budget a view pins pages it draws through an ancestor and never reads.
  {
    name: 'leaves out a page the view pins but no one reads',
    resident: ['a.bin'],
    heard: [
      [1, 2],
      [2, 2],
    ],
  },
]
for (const { name, resident, heard: counts } of held)
  test(`awaitPages ${name} (#408)`, async () => {
    const { lifecycle, streamer } = await lackingPages(['b.bin'], ['a.bin', 'c.bin'], resident)
    const heard: JobProgress[] = []
    await lifecycle.awaitPages({ onProgress: (event) => heard.push(event) })
    assert.deepEqual(
      heard.map(({ completed, total }) => [completed, total]),
      counts,
    )
    streamer.dispose()
  })

// The WebGPU residency reads the pages of its first cut itself, inside its flush, through the
// streamer: the host lacks none of them after it, yet they are the first pages the view waits on.
test('awaitPages hears the pages a backend reads itself while it flushes, as they land (#408)', async () => {
  const { lifecycle, streamer, backend } = await lackingPages([])
  const heard: number[][] = []
  let flushed = false
  Object.assign(backend, {
    flush: async () => {
      if (flushed) return
      flushed = true
      await Promise.all(['a.bin', 'b.bin', 'a.bin'].map((url) => streamer.readBytes(url)))
      assert.deepEqual(heard.at(-1), [2, 2], 'heard while the flush runs')
    },
  })
  await lifecycle.awaitPages({
    onProgress: ({ completed, total }) => heard.push([completed!, total!]),
  })
  assert.deepEqual(heard, [
    [0, 2],
    [1, 2],
    [2, 2],
  ])
  streamer.dispose()
})

test('awaitPages counts a held page once when a backend reads it again after the cut (#408)', async () => {
  const { lifecycle, streamer, backend } = await lackingPages([], ['c.bin'])
  const heard: number[][] = []
  let flushes = 0
  Object.assign(backend, {
    flush: async () => {
      if (++flushes === 2) await streamer.readBytes('c.bin')
    },
  })
  await lifecycle.awaitPages({
    onProgress: ({ completed, total }) => heard.push([completed!, total!]),
  })
  assert.deepEqual(heard.at(-1), [1, 1])
  streamer.dispose()
})

test('a disposed session stops its page reads with a reason, never "aborted without reason"', () => {
  const controller = new AbortController()
  const stub = { dispose() {} }
  const inputs = {
    ...{ check() {}, state: {}, profiler: stub, ownedControls: [] },
    ...{ streamer: stub, engine: { id: 'stub', dispose() {} }, source: undefined },
    streaming: { backgroundFetchController: controller },
  } as unknown as Inputs
  const channel = { flushSync() {}, close() {} }
  const session = { scope: 'slice', diagnosticChannel: channel, diagnose() {}, options: {} }
  createExplorerLifecycle(session as unknown as Session, inputs).dispose()
  assert.equal(controller.signal.aborted, true)
  const reason = controller.signal.reason as DOMException
  assert.deepEqual([reason.name, reason.message], ['AbortError', 'The session closed'])
})
