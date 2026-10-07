// The scene a session draws is read through the queue the session opened first: what it streams is
// catalogued and bound there, and a preparation that fails at any step leaves no queue behind.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageQueue, StreamPage } from '../../streaming/types.ts'
import { ownedUntilReady, sceneThrough } from './pageSources.ts'

/** A queue that records what it is told. */
function queue() {
  const told = { admitted: [] as string[], bound: 0, disposed: 0 }
  const port: PageQueue & { dispose(): void } = {
    admit: (pages: readonly StreamPage[]) => void told.admitted.push(...pages.map((p) => p.url)),
    forget() {},
    readBytes: async () => new Uint8Array(),
    dispose: () => void told.disposed++,
  }
  return { port, told }
}

test('a preparation that fails at any step after the queue opened closes it; a ready one keeps it', async () => {
  const { port, told } = queue()
  const failing = ownedUntilReady(port, async () => {
    await sceneThrough(port, undefined, async () => ({ partitions: [], readers: [] }))
    throw new Error('engines refused') // a step after the scene loaded
  })
  await assert.rejects(failing, /engines refused/)
  assert.equal(await ownedUntilReady(port, async () => 'ready'), 'ready')
  assert.equal(told.disposed, 1)
})

test("a scene read catalogues its partitions' pages and binds its readers to the queue", async () => {
  const { port, told } = queue()
  const page = { url: 'scene-page.json', bytes: 1, sha256: '' }
  const reader = { bind: (bound: PageQueue) => void (told.bound += bound === port ? 1 : 0) }
  const scene = { partitions: [{ pages: [page] }], readers: [reader, reader] }
  assert.equal(await sceneThrough(port, undefined, async () => scene as never), scene)
  assert.deepEqual([told.admitted, told.bound, told.disposed], [['scene-page.json'], 2, 0])
})
