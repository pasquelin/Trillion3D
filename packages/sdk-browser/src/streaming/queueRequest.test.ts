// Every read of a page joins its one job (`queueRequest.ts`, `jobFor`): the GPU page pool's loads
// read through it, and a more urgent read raises the job it joins, counted by the view it waits for
// (#408).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createGpuPageCache, httpPageSource } from '../gpu/page/pages.ts'
import { createPageStreamer } from './pageStreamer.ts'
import { servedPages } from './servedPages.fixture.ts'
import { eventually } from './eventually.fixture.ts'
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from './priority.ts'

test('two GPU loads of one page in flight read it by its one job: one transfer', async () => {
  const previous = globalThis.fetch
  const { pages, fetched } = await servedPages(['a.bin'])
  const heard: string[] = []
  const streamer = createPageStreamer(pages, 'http://cache/', {
    onDiagnostic: ({ phase }) => heard.push(phase),
  })
  const source = {
    read: (key: string, signal?: AbortSignal, priority?: number) =>
      streamer.readBytes(key, signal ?? streamer.signal, priority),
  }
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })
  const cache = createGpuPageCache(device, source, { pageBytes: 12, slots: 1 })
  try {
    const [first, second] = await Promise.all([cache.load('a.bin'), cache.load('a.bin')])
    assert.equal(second, first, 'one resident page')
    assert.deepEqual(fetched, ['http://cache/a.bin'], 'one transfer')
    assert.ok(heard.includes('page-request-coalesced'), 'the second read joined the first')
  } finally {
    await cache.dispose()
    streamer.dispose()
    globalThis.fetch = previous
  }
})

test('two GPU loads of one page in flight over HTTP send one request: the source is a streamer too', async (t) => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  const sent: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    sent.push(String(url))
    await gate
    return new Response(new Uint8Array([1, 2, 3, 4]))
  })
  const { device } = fakeDevice({ limits: { maxBufferSize: 1024 } })
  const cache = createGpuPageCache(device, httpPageSource('http://cache/pages/'), {
    pageBytes: 12,
    slots: 1,
  })
  try {
    const loads = [cache.load('p0.bin'), cache.load('p0.bin')]
    await eventually(() => sent.length === 1)
    release()
    const [first, second] = await Promise.all(loads)
    assert.equal(second, first, 'one resident page')
    assert.deepEqual(sent, ['http://cache/pages/p0.bin'], 'one request')
  } finally {
    release()
    await cache.dispose()
  }
})

test('a view read joining a prefetch in flight is counted and raises it', async () => {
  const previous = globalThis.fetch
  const { pages } = await servedPages(['busy.bin', 'other.bin', 'ahead.bin'])
  const served = globalThis.fetch,
    started: string[] = []
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = async (url, init) => {
    const name = String(url).split('/').at(-1)!
    started.push(name)
    if (name === 'busy.bin') await gate
    return served(url, init)
  }
  const streamer = createPageStreamer(pages, 'http://cache/', {
    workerCount: 1,
    maxTransferBytes: 12,
  })
  const { signal } = streamer
  try {
    const busy = streamer.readBytes('busy.bin', signal, PRIORITY_VISIBLE)
    await eventually(() => started.length === 1)
    const other = streamer.readBytes('other.bin', signal, PRIORITY_VISIBLE + 1)
    const prefetch = streamer.readBytes('ahead.bin', signal, PRIORITY_PREFETCH)
    const progress = streamer.watch(() => {})
    const view = streamer.readBytes('ahead.bin', signal, PRIORITY_VISIBLE)
    assert.deepEqual(progress.reads(), { landed: 0, asked: 1 }, 'the view waits on the page')
    release()
    await Promise.all([busy, other, prefetch, view])
    assert.deepEqual(started, ['busy.bin', 'ahead.bin', 'other.bin'], 'raised, and read once')
    assert.deepEqual(progress.reads(), { landed: 1, asked: 1 })
    progress.stop()
  } finally {
    release()
    streamer.dispose()
    globalThis.fetch = previous
  }
})
