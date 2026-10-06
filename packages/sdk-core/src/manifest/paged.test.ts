import test from 'node:test'
import assert from 'node:assert/strict'
import { manifest, TEMPLATES } from '../../../../tests/fixtures/manifest/manifestBinary.ts'
import { EMPTY, pagedManifest } from '../../../../tests/fixtures/manifest/pagedManifest.ts'
import type { EngineError } from '../contracts/index.ts'
import { decodeManifestBinary } from './binaryDecode.ts'
import { encodeManifestBinary } from '../../../../tests/fixtures/manifest/manifestBinaryEncode.ts'
import { openPagedManifest, readPagedManifest, type PageAsk } from './paged.ts'

/** The manifest one column file gave, before the manifest was paged. */
function whole() {
  const { manifest: slim, binary } = encodeManifestBinary(manifest(), TEMPLATES)
  return decodeManifestBinary(
    { ...slim, binary: { ...slim.binary, sha256: 'f' } },
    binary.buffer as ArrayBuffer,
  )
}

for (const [index, cut] of [false, true].flatMap((i) => [false, true].map((c) => [i, c])))
  test(`the paged manifest reads back what one column file gave${index ? ', through an index page' : ''}${cut ? ', one mesh page per primitive' : ''}`, async () => {
    const { root, files } = pagedManifest(manifest(), index, cut)
    const read = async ({ url }: { url: string }) => files.get(url)!
    assert.deepEqual(await readPagedManifest(root, read), whole())
  })

test('a root that names no head page is refused', async () => {
  const { root, files } = pagedManifest(manifest())
  const refused = readPagedManifest({ ...root, head: EMPTY }, async ({ url }) => files.get(url)!)
  await assert.rejects(refused, (error: EngineError) => error.code === 'INVALID_CACHE')
})

test('an opened manifest holds the mesh pages it is asked for, each read once and dropped with its last holder', async () => {
  const { root, files } = pagedManifest(manifest(), false, true)
  const reads: (number | undefined)[] = [],
    gone: string[] = []
  const read = async ({ url }: { url: string }, asked?: PageAsk) => (
    reads.push(asked?.priority),
    files.get(url)!
  )
  const letGo = ({ url }: { url: string }) => void gone.push(url)
  const { metadata, pages } = await openPagedManifest(root, read, undefined, letGo)
  const { primitives: all, ...head } = whole()
  assert.deepEqual({ ...metadata, primitives: [] }, { ...head, primitives: [] }, 'the head alone')
  assert.equal(metadata.primitives, pages.primitives)
  const [first, second] = root.pages as string[]
  const opened = reads.length
  await Promise.all([
    pages.hold([first], { priority: 1 }),
    pages.hold([first, second], { priority: 3 }),
  ])
  // One read a page on its way, at the priority of the hold that asked it first.
  assert.deepEqual(reads.slice(opened), [1, 3, 1, 3])
  assert.deepEqual(metadata.primitives, all.slice(0, 2))
  pages.release([first, second])
  assert.deepEqual(metadata.primitives, all.slice(0, 1), 'the first is still held')
  assert.equal(gone.length, 2, "the second's page and sidecar let go with their last holder")
  pages.release([first])
  assert.deepEqual([metadata.primitives, pages.changes], [[], 4])
  const landing = pages.hold([second])
  pages.release([second])
  await landing
  assert.deepEqual(metadata.primitives, [], 'released before it landed, never listed')
})

test('holds of one unread page share its read, cancelled once the last of them lets go', async () => {
  const { root, files } = pagedManifest(manifest(), false, true)
  const signals: AbortSignal[] = []
  const read = (page: { url: string }, asked?: PageAsk) =>
    new Promise<Uint8Array>((resolve, reject) => {
      if (!asked?.signal) return resolve(files.get(page.url)!)
      signals.push(asked.signal)
      asked.signal.addEventListener('abort', () => reject(asked.signal!.reason))
    })
  const { pages } = await openPagedManifest(root, read)
  const [first] = root.pages as string[]
  const [a, b] = [new AbortController(), new AbortController()]
  const holds = [a, b].map(({ signal }) => pages.hold([first], { signal, priority: 1 }))
  assert.equal(signals.length, 1, 'one read for both')
  a.abort()
  assert.equal(signals[0].aborted, false, 'one asker still waits on it')
  b.abort()
  assert.equal(signals[0].aborted, true, 'the last let go: cancelled')
  for (const hold of holds) await assert.rejects(hold, { name: 'AbortError' })
})
