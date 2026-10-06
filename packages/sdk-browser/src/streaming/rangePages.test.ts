// A range of another file is a page of the queue: read by an HTTP Range, its parts checked where
// they lie, kept by those who ask it alone, and, once under way, read to its end for whoever asks it
// again.
import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from './sha256Hex.ts'
import { createPageStreamer } from './pageStreamer.ts'

/** A file of two parts of four bytes, `gap` bytes apart, served by Range, each answer held until
 *  `release`: the pages of its ranges, the ranges asked, and the signals they were asked with. */
async function served(t: TestContext, gap = 0) {
  const parts = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])]
  const file = new Uint8Array([...parts[0], ...new Uint8Array(gap), ...parts[1]])
  const sha = await Promise.all(parts.map((part) => sha256Hex(part.slice().buffer)))
  const asked: string[] = [],
    signals: AbortSignal[] = []
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  t.after(release)
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string>).Range
    asked.push(range)
    signals.push(init!.signal!)
    await gate
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return new Response(file.slice(from, to + 1), { status: 206 })
  })
  const page = (url: string) => ({
    ...{ url, bytes: file.byteLength, sha256: '' },
    range: {
      file: 'world.bin',
      offset: 0,
      parts: [0, 4 + gap].map((offset, at) => ({ offset, bytes: 4, sha256: sha[at] })),
    },
    kept: false,
  })
  return { page, asked, signals, release }
}

test('a range of another file is a page of the queue: by a Range, checked part by part, kept by its askers', async (t) => {
  const { page, asked, release } = await served(t)
  const streamer = createPageStreamer([page('near'), page('far')], 'http://cache/', {
    workerCount: 1,
  })
  t.after(() => streamer.dispose())
  const near = streamer.readBytes('near', undefined, 1)
  const far = streamer.readBytes('far', undefined, 3)
  await new Promise(setImmediate)
  assert.deepEqual([asked, streamer.stats().queued], [['bytes=0-7'], 1], 'one transfer, held')
  release()
  assert.deepEqual([...(await near), ...(await far)].length, 16)
  assert.deepEqual([streamer.has('near'), streamer.stats().loaded], [false, 2], 'read, not cached')
})

test('a range whose parts are not end to end is checked where each part lies', async (t) => {
  const { page, release } = await served(t, 3)
  const streamer = createPageStreamer([page('padded')], 'http://cache/')
  t.after(() => streamer.dispose())
  release()
  const bytes = await streamer.readBytes('padded')
  assert.deepEqual([...bytes], [1, 2, 3, 4, 0, 0, 0, 5, 6, 7, 8])
  assert.equal(streamer.stats().failed, 0)
})

test('a range whose last asker lets go while it transfers is read to its end: asked again meanwhile, read once', async (t) => {
  const { page, asked, signals, release } = await served(t)
  const streamer = createPageStreamer([page('back')], 'http://cache/')
  t.after(() => streamer.dispose())
  const letGo = new AbortController()
  const left = streamer.readBytes('back', letGo.signal)
  await new Promise(setImmediate)
  letGo.abort()
  await assert.rejects(left, { name: 'AbortError' })
  assert.deepEqual([signals[0].aborted, streamer.loading('back')], [false, true], 'still under way')
  const again = streamer.readBytes('back') // the cell held again
  release()
  assert.equal((await again).byteLength, 8)
  assert.deepEqual(asked, ['bytes=0-7'], 'read once')
})
