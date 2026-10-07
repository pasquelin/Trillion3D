// The scene a session draws is read through the queue the session opened first: what it streams is
// catalogued and bound there.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { PageQueue, StreamPage } from '../../streaming/types.ts'
import { sceneThrough } from './pageSources.ts'

/** A queue that records what it is told. */
function queue() {
  const told = { admitted: [] as string[], bound: 0 }
  const port: PageQueue = {
    admit: (pages: readonly StreamPage[]) => void told.admitted.push(...pages.map((p) => p.url)),
    forget() {},
    readBytes: async () => new Uint8Array(),
    signal: new AbortController().signal,
  }
  return { port, told }
}

test("a scene read catalogues its partitions' pages and binds its world roots to the queue", async () => {
  const { port, told } = queue()
  const page = { url: 'scene-page.json', bytes: 1, sha256: '' }
  const roots = { bind: (bound: PageQueue) => void (told.bound += bound === port ? 1 : 0) }
  const scene = { partitions: [{ pages: [page] }], worldRoots: [roots, roots] }
  assert.equal(await sceneThrough(port, undefined, async () => scene as never), scene)
  assert.deepEqual([told.admitted, told.bound], [['scene-page.json'], 2])
})
