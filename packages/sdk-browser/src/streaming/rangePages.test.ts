// A range of another file is a page of the queue, read by an HTTP Range and checked against its own
// digest, kept by those who ask it alone. The ranges queued end to end in one file are one request,
// each checked where it lies; once under way, a range is read to its end for whoever asks it again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from './sha256Hex.ts'
import { createPageStreamer } from './pageStreamer.ts'
import type { StreamPage } from './types.ts'

/** A file of `count` parts of four bytes (part i holds 4i + 1 … 4i + 4), served by Range, each
 *  answer held until `release` when `held`: a page per part, `gap` bytes between parts, a
 *  part's digest spoiled when `wrong`; the ranges asked. */
async function served(t: TestContext, count: number, { gap = 0, wrong = -1, held = false } = {}) {
  const parts = Array.from({ length: count }, (_, i) =>
    Uint8Array.from({ length: 4 }, (_, k) => 4 * i + k + 1),
  )
  const file = new Uint8Array(count * (4 + gap))
  parts.forEach((part, i) => file.set(part, i * (4 + gap)))
  const asked: string[] = []
  let release = () => {}
  const gate = held ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
  t.after(release)
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string>).Range
    asked.push(range)
    await gate
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return new Response(file.slice(from, to + 1), { status: 206 })
  })
  const pages: StreamPage[] = await Promise.all(
    parts.map(async (part, i) => ({
      ...{ url: `part${i}`, bytes: 4, kept: false },
      sha256: i === wrong ? '0'.repeat(64) : await sha256Hex(part.slice().buffer),
      range: { file: 'world.bin', offset: i * (4 + gap) },
    })),
  )
  const streamer = createPageStreamer(pages, 'http://cache/', { workerCount: 1 })
  t.after(() => streamer.dispose())
  return { streamer, asked, release }
}

test('ranges end to end asked within a task are one request, each checked, kept by their askers', async (t) => {
  const { streamer, asked } = await served(t, 3)
  const read = await Promise.all([0, 1, 2].map((i) => streamer.readBytes(`part${i}`)))
  assert.deepEqual(asked, ['bytes=0-11'])
  assert.deepEqual(
    read.map((bytes) => [...bytes]),
    [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ],
  )
  assert.deepEqual([streamer.has('part0'), streamer.stats().loaded], [false, 3], 'not cached')
})

test('ranges queued behind a transfer are merged with their neighbours as it frees', async (t) => {
  const { streamer, asked, release } = await served(t, 4, { held: true })
  const first = streamer.readBytes('part0')
  await new Promise(setImmediate)
  const rest = [3, 1, 2].map((i) => streamer.readBytes(`part${i}`)) // queued out of order
  await new Promise(setImmediate)
  release()
  await Promise.all([first, ...rest])
  assert.deepEqual(asked, ['bytes=0-3', 'bytes=4-15'], 'the three queued, one request')
})

test('ranges that are not end to end are read apart', async (t) => {
  const { streamer, asked } = await served(t, 2, { gap: 3 })
  await Promise.all([streamer.readBytes('part0'), streamer.readBytes('part1')])
  assert.deepEqual(asked, ['bytes=0-3', 'bytes=7-10'])
})

test('a range of a merged read whose bytes are not its own fails alone: the others land', async (t) => {
  const { streamer, asked } = await served(t, 3, { wrong: 1 })
  let settled = false
  const [a, b, c] = [0, 1, 2].map((i) => streamer.readBytes(`part${i}`))
  b.then(
    () => (settled = true),
    () => (settled = true),
  )
  assert.deepEqual(
    [[...(await a)], [...(await c)]],
    [
      [1, 2, 3, 4],
      [9, 10, 11, 12],
    ],
  )
  assert.deepEqual(asked, ['bytes=0-11'])
  assert.deepEqual([settled, streamer.loading('part1')], [false, true], 'it may pass: it waits')
})

test('a range whose last asker lets go while it transfers is read to its end: asked again, read once', async (t) => {
  const { streamer, asked, release } = await served(t, 1, { held: true })
  const letGo = new AbortController()
  const left = streamer.readBytes('part0', letGo.signal)
  await new Promise(setImmediate)
  letGo.abort()
  await assert.rejects(left, { name: 'AbortError' })
  assert.equal(streamer.loading('part0'), true, 'still under way')
  const again = streamer.readBytes('part0') // the cell held again
  release()
  assert.equal((await again).byteLength, 4)
  assert.deepEqual(asked, ['bytes=0-3'], 'read once')
})
