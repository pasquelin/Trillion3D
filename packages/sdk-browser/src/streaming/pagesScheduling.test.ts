import test from 'node:test'
import assert from 'node:assert/strict'
import { sha256Hex } from './sha256Hex.ts'
import { createPageStreamer } from './pageStreamer.ts'
test('a priority read overtakes queued detail without exceeding one transfer', async () => {
  const bytes = new Uint32Array([0, 1, 2])
  const sha = await sha256Hex(bytes.buffer)
  const started: string[] = [],
    previous = globalThis.fetch
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').at(-1)!
    started.push(name)
    if (name === 'a.bin') await gate
    return new Response(bytes)
  }
  const pages = ['a.bin', 'b.bin', 'c.bin'].map((url) => ({ url, bytes: 12, sha256: sha }))
  const streamer = createPageStreamer(pages, 'http://cache/', {
    workerCount: 1,
    maxTransferBytes: 12,
  })
  try {
    const detail = streamer.request(['a.bin', 'b.bin'], { priority: 2 })
    const urgent = streamer.read('c.bin')
    assert.deepEqual(started, ['a.bin'])
    assert.equal(streamer.stats().transferInFlightBytes, 12)
    release()
    await Promise.all([detail, urgent])
    assert.deepEqual(started, ['a.bin', 'c.bin', 'b.bin'])
    assert.equal(streamer.stats().transferInFlightBytes, 0)
  } finally {
    release()
    streamer.dispose()
    globalThis.fetch = previous
  }
})

test('cancelling obsolete detail leaves a shared page request alive', async () => {
  const bytes = new Uint32Array([0, 1, 2])
  const sha = await sha256Hex(bytes.buffer)
  const previous = globalThis.fetch
  let release!: () => void,
    attempts = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  globalThis.fetch = async () => {
    attempts++
    await gate
    return new Response(bytes)
  }
  const streamer = createPageStreamer(
    [{ url: 'shared.bin', bytes: 12, sha256: sha }],
    'http://cache/',
    { workerCount: 1 },
  )
  const obsolete = new AbortController()
  try {
    const old = streamer.request(['shared.bin'], { signal: obsolete.signal })
    const current = streamer.read('shared.bin')
    obsolete.abort()
    release()
    await assert.rejects(old, { name: 'AbortError' })
    assert.deepEqual([...(await current)], [0, 1, 2])
    assert.equal(attempts, 1)
    assert.equal(streamer.stats().failed, 0)
  } finally {
    release()
    streamer.dispose()
    globalThis.fetch = previous
  }
})

test('stream diagnostics cover coalescing, verification, retention and eviction', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0])
  const sha = await sha256Hex(bytes.buffer)
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response(bytes)
  const events: string[] = []
  const streamer = createPageStreamer(
    [
      { url: 'a.bin', bytes: 4, sha256: sha },
      { url: 'b.bin', bytes: 4, sha256: sha },
    ],
    'http://cache/',
    {
      workerCount: 2,
      maxPages: 1,
      maxTransferBytes: 8,
      onDiagnostic: (event) => {
        events.push(event.phase)
        if (events.length === 1) throw new Error('observer failure')
      },
    },
  )
  try {
    await Promise.all([streamer.read('a.bin'), streamer.read('a.bin')])
    streamer.retain([])
    await streamer.request(['b.bin'])
    streamer.retain(['b.bin'])
    assert.ok(events.includes('page-catalogue'))
    assert.ok(events.includes('page-request-coalesced'))
    assert.ok(events.includes('page-hash-check'))
    assert.ok(events.includes('page-cache-eviction'))
    assert.ok(streamer.stats().evictions > 0)
  } finally {
    streamer.dispose()
    globalThis.fetch = previous
  }
})

test('a range of another file is a page of the queue: by a Range, checked part by part, never cached', async () => {
  const parts = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])]
  const digests = await Promise.all(parts.map((part) => sha256Hex(part.slice().buffer)))
  const file = new Uint8Array([...parts[0], ...parts[1], ...parts[0], ...parts[1]])
  const previous = globalThis.fetch,
    asked: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  globalThis.fetch = async (_url, init) => {
    const range = (init?.headers as Record<string, string>).Range
    asked.push(range)
    await gate
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return new Response(file.slice(from, to + 1), { status: 206 })
  }
  const span = (url: string, offset: number) => ({
    ...{ url, bytes: 8, sha256: '' },
    range: {
      file: 'world.bin',
      offset,
      parts: parts.map((p, at) => ({ bytes: p.byteLength, sha256: digests[at] })),
    },
  })
  const streamer = createPageStreamer(
    [span('near', 0), span('far', 8), span('gone', 0)],
    'http://cache/',
    {
      workerCount: 1,
    },
  )
  const letGo = new AbortController()
  try {
    const near = streamer.readBytes('near', undefined, 1)
    const far = streamer.readBytes('far', undefined, 3)
    const gone = streamer.readBytes('gone', letGo.signal, 2)
    await new Promise(setImmediate)
    assert.deepEqual([asked, streamer.stats().queued], [['bytes=0-7'], 2], 'one transfer, held')
    letGo.abort()
    release()
    await assert.rejects(gone, { name: 'AbortError' })
    assert.deepEqual(
      [...(await near), ...(await far)],
      [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8],
    )
    assert.deepEqual(asked, ['bytes=0-7', 'bytes=8-15'], 'nearer first; the one let go is unread')
    assert.deepEqual(
      [streamer.has('near'), streamer.stats().loaded],
      [false, 2],
      'read, not cached',
    )
  } finally {
    release()
    streamer.dispose()
    globalThis.fetch = previous
  }
})
