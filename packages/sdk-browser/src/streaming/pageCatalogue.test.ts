import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageCache } from './pageCache.ts'
import { createPageStreamer, createPageStreamerWith } from './pageStreamer.ts'
import { servedPages } from './servedPages.fixture.ts'
import { manifestTableBytes } from './manifestTables.ts'

test('a mounted page joins the catalogue, is read and cached, then leaves it with its bytes', async () => {
  const { pages, fetched } = await servedPages(['open.bin', 'mounted.bin'])
  const streamer = createPageStreamer([pages[0]], 'http://site.test/')
  try {
    await assert.rejects(streamer.readBytes('mounted.bin'), /Unknown page/, 'not opened with it')
    streamer.admit([pages[1]])
    await streamer.readBytes('mounted.bin')
    assert.ok(streamer.has('mounted.bin'), 'read like a page it opened with')
    streamer.forget(['mounted.bin'])
    assert.ok(!streamer.has('mounted.bin'), 'its bytes leave with it')
    await assert.rejects(streamer.readBytes('mounted.bin'), /Unknown page/)
    assert.deepEqual(fetched, ['http://site.test/mounted.bin'])
  } finally {
    streamer.dispose()
  }
})

test('the tables of pages admitted after the open are counted in the CPU bytes, and leave with them', async () => {
  const { pages } = await servedPages(['open.bin', 'index-page.json'])
  const streamer = createPageStreamer([pages[0]], 'http://site.test/')
  try {
    const before = streamer.stats().cpuBytes
    streamer.admit([pages[1]])
    streamer.admit([pages[1]]) // admitted again: counted once
    assert.equal(streamer.stats().cpuBytes - before, manifestTableBytes([pages[1]]))
    streamer.forget(['index-page.json'])
    assert.equal(streamer.stats().cpuBytes, before)
  } finally {
    streamer.dispose()
  }
})

/** Serves `urls` as `servedPages` does, each read held until `release` runs. */
async function heldPages(urls: readonly string[]) {
  const served = await servedPages(urls)
  const serve = globalThis.fetch
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = async (input, init) => {
    await gate
    return serve(input, init)
  }
  return { ...served, release }
}
/** Lets a settled read run its queue's `finally`. */
const settled = () => new Promise((resolve) => setTimeout(resolve))

test('a page forgotten while it is read leaves with its bytes once the read settles', async () => {
  const { pages, release } = await heldPages(['open.bin', 'mounted.bin'])
  const streamer = createPageStreamer([pages[0]], 'http://site.test/')
  try {
    streamer.admit([pages[1]])
    const reading = streamer.readBytes('mounted.bin')
    streamer.forget(['mounted.bin'])
    assert.ok(streamer.loading('mounted.bin'), 'its read goes on')
    release()
    await reading
    await settled()
    assert.ok(!streamer.has('mounted.bin'), 'its bytes leave once it settles')
    await assert.rejects(streamer.readBytes('mounted.bin'), /Unknown page/)
  } finally {
    streamer.dispose()
  }
})

test('a page forgotten then admitted again while it is read stays catalogued and cached', async () => {
  const { pages, fetched, release } = await heldPages(['open.bin', 'mounted.bin'])
  const streamer = createPageStreamer([pages[0]], 'http://site.test/')
  try {
    streamer.admit([pages[1]])
    const reading = streamer.readBytes('mounted.bin')
    streamer.forget(['mounted.bin'])
    streamer.admit([pages[1]])
    release()
    await reading
    await settled()
    assert.ok(streamer.has('mounted.bin'), 'the new admission keeps its bytes')
    await streamer.readBytes('mounted.bin')
    assert.deepEqual(fetched, ['http://site.test/mounted.bin'], 'read once')
  } finally {
    streamer.dispose()
  }
})

test('a page forgotten while its read waits leaves once that read is dropped', async () => {
  const { pages, release } = await heldPages(['open.bin', 'mounted.bin'])
  const streamer = createPageStreamer(pages, 'http://site.test/', { workerCount: 1 })
  try {
    const first = streamer.readBytes('open.bin')
    const waiting = new AbortController()
    const reading = streamer.readBytes('mounted.bin', waiting.signal)
    streamer.forget(['mounted.bin'])
    waiting.abort()
    await assert.rejects(reading, /abort/i)
    assert.ok(!streamer.loading('mounted.bin'), 'its read left the queue')
    release()
    await first
    await assert.rejects(streamer.readBytes('mounted.bin'), /Unknown page/)
  } finally {
    streamer.dispose()
  }
})

test('a page forgotten while it is read stays in the kept cache the next session holds', async () => {
  const { pages, release } = await heldPages(['open.bin', 'mounted.bin'])
  const cache = createPageCache()
  const first = createPageStreamerWith(pages, 'http://site.test/', { cache })
  const reading = first.readBytes('mounted.bin').catch(() => undefined)
  first.forget(['mounted.bin'])
  first.dispose()
  await servedPages(['open.bin', 'mounted.bin'])
  const next = createPageStreamerWith(pages, 'http://site.test/', { cache })
  try {
    await next.readBytes('mounted.bin')
    release()
    await reading
    await settled()
    assert.ok(next.has('mounted.bin'), 'the late settle leaves the next session its bytes')
  } finally {
    next.dispose()
  }
})
