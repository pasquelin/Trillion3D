// A lazy manifest's mesh pages, once a session binds its queue, wait in it with every other read,
// at the priority each hold asks.
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
