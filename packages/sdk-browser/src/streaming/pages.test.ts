import test from 'node:test'
import assert from 'node:assert/strict'
import { eventually } from './eventually.fixture.ts'
import { sha256Hex } from './sha256Hex.ts'
import { createPageStreamer } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'
import { servedPages } from './servedPages.fixture.ts'
import { manifestTableBytes } from './manifestTables.ts'
import { retained } from './retained.fixture.ts'

const TRANSFER = 64,
  PAGE = 12

/** Three verified pages served whole, two workers, room for two resident pages: the cache's bytes
 *  less the manifest tables and the transfer queue. */
async function twoOfThreeStreamer(onEvict?: (url: string) => void) {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0])
  const sha = await sha256Hex(bytes.buffer)
  globalThis.fetch = async () => new Response(bytes, { status: 200 })
  const pages = ['a.bin', 'b.bin', 'c.bin'].map((url) => ({
    url,
    bytes: bytes.byteLength,
    sha256: sha,
  }))
  return createPageStreamer(pages, 'http://cache/', {
    cache: createPageCache(manifestTableBytes(pages) + TRANSFER + 2 * PAGE),
    workerCount: 2,
    maxTransferBytes: TRANSFER,
    onEvict,
  })
}

const ALL = ['a.bin', 'b.bin', 'c.bin']

test('streamer fetches only requested pages and counts hits', async () => {
  const { pages, fetched } = await servedPages(['a.bin', 'b.bin'])
  const streamer = createPageStreamer(pages, 'http://cache/', { cache: createPageCache() })
  await streamer.request(['a.bin'], { signal: streamer.signal })
  assert.deepEqual(fetched, ['http://cache/a.bin'])
  assert.equal(streamer.get('a.bin')?.[0], 1)
  assert.equal(streamer.get('b.bin'), undefined)
  await streamer.request(['a.bin'], { signal: streamer.signal })
  assert.equal(streamer.stats().hits, 1)
  assert.equal(streamer.stats().loaded, 1)
  streamer.dispose()
})
test('streamer LRU evicts unpinned pages and retains pinned ones', async () => {
  const streamer = await twoOfThreeStreamer()
  await streamer.request(['a.bin', 'b.bin'], { signal: streamer.signal })
  assert.equal(streamer.stats().resident, 2)
  retained(streamer, ALL)(['a.bin'])
  await streamer.request(['c.bin'], { signal: streamer.signal })
  assert.equal(streamer.has('a.bin'), true)
  assert.equal(streamer.has('c.bin'), true)
  assert.equal(streamer.has('b.bin'), false)
  assert.ok(streamer.stats().evictions >= 1)
  streamer.dispose()
})
test('streamer notifies consumers when a page is evicted', async () => {
  const dropped: string[] = []
  const streamer = await twoOfThreeStreamer((url) => dropped.push(url))
  await streamer.request(['a.bin', 'b.bin'], { signal: streamer.signal })
  retained(streamer, ALL)(['a.bin'])
  await streamer.request(['c.bin'], { signal: streamer.signal })
  assert.ok(dropped.includes('b.bin'))
  streamer.dispose()
})

test('a page pinned before it lands survives a full budget of pinned pages until it is unpinned', async () => {
  const evicted: string[] = []
  const streamer = await twoOfThreeStreamer((url) => evicted.push(url))
  streamer.pin('a.bin')
  streamer.pin('b.bin')
  await streamer.request(['a.bin', 'b.bin'], { signal: streamer.signal })
  // An ahead page asked: pinned before its read lands, in a cache full of pinned pages.
  streamer.pin('c.bin')
  await streamer.request(['c.bin'], { signal: streamer.signal })
  assert.deepEqual(evicted, [], 'the pinned pages are all held, the budget passed')
  assert.equal(streamer.has('c.bin'), true)
  // Pinned by a second owner: one letting go frees nothing.
  streamer.pin('c.bin')
  streamer.unpin('c.bin')
  assert.equal(streamer.has('c.bin'), true)
  streamer.unpin('c.bin')
  assert.deepEqual(evicted, ['c.bin'], 'unpinned, it is the one the budget takes')
  streamer.dispose()
})

test('the bootstrap reader verifies pages and shares in-flight requests', async () => {
  const bytes = new Uint32Array([0, 1, 2])
  const sha = await sha256Hex(bytes.buffer)
  let attempts = 0
  const previous = globalThis.fetch
  globalThis.fetch = async () => {
    attempts++
    return new Response(bytes)
  }
  const streamer = createPageStreamer([{ url: 'a.bin', bytes: 12, sha256: sha }], 'http://cache/', {
    cache: createPageCache(),
  })
  try {
    const [a, b] = await Promise.all([
      streamer.read('a.bin', streamer.signal),
      streamer.read('a.bin', streamer.signal),
    ])
    assert.deepEqual([...a], [0, 1, 2])
    assert.equal(a, b)
    assert.equal(attempts, 1)
  } finally {
    streamer.dispose()
    globalThis.fetch = previous
  }
})

test('cancellation stops outstanding loads without retrying or recording a source failure', async () => {
  const controller = new AbortController()
  let attempts = 0,
    release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const previous = globalThis.fetch
  globalThis.fetch = async () => {
    attempts++
    await gate
    return new Response(new Uint32Array([0, 1, 2]))
  }
  const streamer = createPageStreamer(
    [{ url: 'a.bin', bytes: 12, sha256: 'unused' }],
    'http://cache/',
    { cache: createPageCache(), signal: controller.signal },
  )
  try {
    const job = streamer.read('a.bin', streamer.signal)
    await eventually(() => attempts === 1) // its transfer under way
    controller.abort()
    release()
    await assert.rejects(job, { name: 'AbortError' })
    assert.equal(attempts, 1)
    assert.equal(streamer.stats().failed, 0)
    assert.equal(streamer.stats().resident, 0)
  } finally {
    release()
    streamer.dispose()
    globalThis.fetch = previous
  }
})
test('a rank delta that changes nothing moves no pin, one that changes follows', async () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0])
  const sha = await sha256Hex(bytes.buffer)
  globalThis.fetch = async () => new Response(bytes, { status: 200 })
  const pages = ALL.map((url) => ({ url, bytes: bytes.byteLength, sha256: sha }))
  const evicted: string[] = []
  // Budget of two pages: the third arrival must reclaim the slot of an unpinned one.
  const streamer = createPageStreamer(pages, 'http://cache/', {
    cache: createPageCache(manifestTableBytes(pages) + TRANSFER + 2 * PAGE),
    workerCount: 1,
    maxTransferBytes: TRANSFER,
    onEvict: (url) => evicted.push(url),
  })
  const retain = retained(streamer, ALL)
  await streamer.request(['a.bin', 'b.bin'], { signal: streamer.signal })
  retain(['a.bin'])
  retain(['a.bin'])
  await streamer.request(['c.bin'], { signal: streamer.signal })
  assert.deepEqual(evicted, ['b.bin'], 'the pinned page survived, the other did not')
  assert.equal(streamer.has('a.bin'), true)
  assert.equal(streamer.has('c.bin'), true)
  // The set changes: pins follow, and the page no longer in it becomes reclaimable.
  retain(['c.bin'])
  await streamer.request(['b.bin'], { signal: streamer.signal })
  assert.deepEqual(evicted, ['b.bin', 'a.bin'])
  streamer.dispose()
})

test('a rank delta reports what it added and removed, not the totals', async () => {
  const { pages } = await servedPages(['a.bin', 'b.bin', 'c.bin'])
  const told: { added: number; removed: number }[] = []
  const streamer = createPageStreamer(pages, 'http://cache/', {
    cache: createPageCache(),
    onDiagnostic: ({ phase, context }) =>
      phase === 'page-retain' && told.push(context as (typeof told)[number]),
  })
  const retain = retained(streamer, ALL)
  retain(['a.bin', 'b.bin'])
  retain(['b.bin', 'c.bin'])
  assert.deepEqual(
    told.map(({ added, removed }) => [added, removed]),
    [
      [2, 0],
      [1, 1],
    ],
  )
  streamer.dispose()
})
