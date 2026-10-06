// A lazy manifest's mesh pages, once a session binds its queue, wait in it with every other read,
// at the priority each hold asks, and are held once, by the primitives that view them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { manifest } from '../../../../tests/fixtures/manifest/manifestBinary.ts'
import { pagedManifest } from '../../../../tests/fixtures/manifest/pagedManifest.ts'
import { openPagedManifest } from '../../../sdk-core/src/manifest/paged.ts'
import { unmetered } from '../cluster/byteMeter.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { pageReader } from './manifestPages.ts'

test("a cell's mesh pages wait in the session's queue, at the priority its hold asks", async (t) => {
  const { root, files } = pagedManifest(manifest(), false, true)
  const busy = new Uint8Array(4)
  files.set('busy.bin', busy)
  const sent: string[] = []
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const name = url.split('/').at(-1)!
    sent.push(name)
    if (name === 'busy.bin') await landing
    return new Response(files.get(name)!.slice())
  })
  // The head is read as the manifest loads; the mesh pages once the session binds its queue.
  const reader = pageReader('http://cache/clusters.json', undefined, unmetered)
  const { metadata, pages } = await openPagedManifest(root, reader.read)
  const sha256 = createHash('sha256').update(busy).digest('hex')
  const streamer = createPageStreamer([{ url: 'busy.bin', bytes: 4, sha256 }], 'http://cache/', {
    workerCount: 1,
  })
  reader.bind(streamer)
  try {
    const [far, near] = root.pages as string[]
    const opened = sent.length
    const before = streamer.readBytes('busy.bin')
    const held = [pages.hold([far], { priority: 3 }), pages.hold([near], { priority: 1 })]
    await new Promise(setImmediate)
    assert.deepEqual(sent.slice(opened), ['busy.bin'], 'they wait for the transfer the queue holds')
    land()
    await Promise.all([before, ...held])
    const first = sent[opened + 1]
    assert.equal(first, `manifest-page-${near.slice(0, 64)}.json`, 'the nearer cell first')
    assert.equal(metadata.primitives.length, 2)
  } finally {
    land()
    streamer.dispose()
  }
})

test('a mesh page no hold wants any more leaves the session catalogue, read or failed', async (t) => {
  const { root, files } = pagedManifest(manifest(), false, true)
  const [read, failed] = root.pages as string[]
  const refused = `manifest-page-${failed.slice(0, 64)}.json`
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    const name = url.split('/').at(-1)!
    return name === refused
      ? new Response('', { status: 404 })
      : new Response(files.get(name)!.slice())
  })
  const reader = pageReader('http://cache/clusters.json', undefined, unmetered)
  const { pages } = await openPagedManifest(root, reader.read, undefined, reader.letGo)
  const streamer = createPageStreamer([], 'http://cache/')
  t.after(() => streamer.dispose())
  reader.bind(streamer)
  await pages.hold([read])
  await assert.rejects(pages.hold([failed]), /PAGE_STREAM_FAILED/)
  const url = (slot: string) => `http://cache/manifest-page-${slot.slice(0, 64)}.json`
  assert.equal(streamer.failed(url(failed)), true)
  pages.release([read, failed])
  for (const slot of [read, failed])
    await assert.rejects(streamer.readBytes(url(slot)), /Unknown page/)
  assert.equal(streamer.stats().failed, 0, 'its failure left with it')
})

test('a mesh page read through the queue is held by its primitives alone: the page cache never keeps it', async (t) => {
  const { root, files } = pagedManifest(manifest(), false, true)
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    return new Response(files.get(url.split('/').at(-1)!)!.slice())
  })
  const reader = pageReader('http://cache/clusters.json', undefined, unmetered)
  const { metadata, pages } = await openPagedManifest(root, reader.read)
  const streamer = createPageStreamer([], 'http://cache/')
  t.after(() => streamer.dispose())
  reader.bind(streamer)
  const [slot] = root.pages as string[]
  await pages.hold([slot])
  assert.equal(metadata.primitives.length, 1)
  const url = `http://cache/manifest-page-${slot.slice(0, 64)}.json`
  assert.deepEqual([streamer.has(url), streamer.stats().residentBytes], [false, 0])
})
