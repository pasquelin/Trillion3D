// The held HLOD cells' roots in the WebGPU cut's cover: each joins it while its cell holds it, until the
// backend ends. On the cook’s world, served.
import test from 'node:test'
import assert from 'node:assert/strict'
import { coverHeldRoots, withWorldRoot } from './worldRoot.ts'
import { placed, scene } from './worldRoot.fixture.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'

test("a held cell's roots gain a holder while it holds them, until the backend ends", async (t) => {
  const { context, hold, opaque } = await scene(t)
  const roots = [placed(opaque)] as unknown as ClusterRoot<PageRec>[]
  const { roots: selectionRoots } = withWorldRoot(
    { roots, allPages: [], requests: new Map() },
    context,
  )
  const told: [string[], boolean][] = []
  const holdCover = (pages: readonly PageRec[], held: boolean) =>
    void told.push([pages.map((page) => page.url), held])
  let woken = 0
  const ends = new AbortController()
  const rt = {
    ...{ context, layout: { selectionRoots }, signal: ends.signal },
    run: { gate: { resourcesChanged: () => woken++ } },
  }
  coverHeldRoots(rt as unknown as Parameters<typeof coverHeldRoots>[0], { holdCover })
  // Cell 0 holds bundles 1 and 3: bundle 1 carries its HLOD 1 root.
  await hold.hold(0)
  const copies = hold.dag!.held.get(1)!.map((rank) => selectionRoots[1].pages[rank].url)
  assert.equal(copies.length, 1)
  assert.deepEqual(told, [[copies, true]])
  assert.equal(woken, 1, 'the next image asks for them')
  hold.release(0)
  assert.deepEqual(told.at(-1), [copies, false], 'its cell let go, they leave the cover')
  await hold.hold(0)
  ends.abort()
  assert.deepEqual(told.at(-1), [copies, false], 'the backend gone, the cover lets go')
  hold.release(0)
  await hold.hold(0)
  assert.equal(told.length, 4, 'nothing followed past the end')
})
