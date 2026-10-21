// The held HLOD cells' roots in the WebGPU cut's cover: each joins it while its cell holds it, until the
// backend ends. On the cook’s world, served.
import test from 'node:test'
import assert from 'node:assert/strict'
import { coverHeldRoots, withWorldRoot } from './worldRoot.ts'
import { placed, scene } from './worldRoot.fixture.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'

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
  // Cell 0 holds root pages 1 and 3 (the table's `hlod`): every cluster of each joins the cover with
  // its cell — bundle 1's HLOD 1 root, and bundle 3's three level 0 clusters beside it.
  const copiesOf = (bundle: number) =>
    hold.dag!.held.get(bundle)!.map((rank) => selectionRoots[1].pages[rank].url)
  const [one, three] = [copiesOf(1), copiesOf(3)]
  assert.deepEqual([one.length, three.length], [1, 3])
  await hold.hold(0)
  assert.deepEqual(told, [
    [one, true],
    [three, true],
  ])
  assert.equal(woken, 2, 'the next image asks for them, for each root page')
  hold.release(0)
  assert.deepEqual(told.slice(2), [
    [one, false],
    [three, false],
  ])
  await hold.hold(0)
  ends.abort()
  assert.deepEqual(told.slice(-2), [
    [one, false],
    [three, false],
  ])
  hold.release(0)
  await hold.hold(0)
  assert.equal(told.length, 8, 'nothing followed past the end')
})
