// The held cells' roots in the WebGPU cut's cover: each joins it while its cell holds it, until the
// backend ends, within the room the session that set it leaves them. On the cook's world, served.
import test from 'node:test'
import assert from 'node:assert/strict'
import { coverHeldRoots, withWorldRoot } from './worldRoot.ts'
import { placed, scene } from './worldRoot.fixture.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'

test("a held cell's roots gain a holder while it holds them, until the backend ends", async (t) => {
  const { context, hold, opaque } = await scene(t, true)
  const roots = [placed(opaque)] as unknown as ClusterRoot<PageRec>[]
  const { roots: selectionRoots } = withWorldRoot({ roots, allPages: [], requestCount: 0 }, context)
  const told: [string[], boolean][] = []
  const holdCover = (pages: readonly PageRec[], held: boolean) =>
    void told.push([pages.map((page) => page.url), held])
  let woken = 0
  const ends = new AbortController()
  const rt = {
    ...{ context, layout: { selectionRoots }, signal: ends.signal },
    run: { gate: { resourcesChanged: () => woken++ } },
    setup: { floorPages: 8, bootstrap: { length: 6 } },
  }
  // The cache's room past the cover: 58 slots, two of them the floor's other pages.
  coverHeldRoots(rt as unknown as Parameters<typeof coverHeldRoots>[0], { holdCover }, () => 58)
  // Cell 0 holds bundles 1 and 3: bundle 1 carries the lone object's two copies.
  await hold.hold(0)
  const copies = hold.drawn!.dag!.held.get(1)!.map((rank) => selectionRoots[1].pages[rank].url)
  assert.equal(copies.length, 2)
  assert.deepEqual(told, [[copies, true]])
  assert.equal(woken, 1, 'the next image asks for them')
  assert.equal(hold.cover.room!(), 56)
  assert.ok(hold.cover.admits(0))
  hold.release(0)
  assert.deepEqual(told.at(-1), [copies, false], 'its cell let go, they leave the cover')
  await hold.hold(0)
  ends.abort()
  assert.deepEqual(told.at(-1), [copies, false], 'the backend gone, the cover lets go')
  assert.equal(hold.cover.room, undefined)
  hold.release(0)
  await hold.hold(0)
  assert.equal(told.length, 4, 'nothing followed past the end')
})

test('a session that ends leaves the room of one that started since: the room is its own', async (t) => {
  const { context, opaque, hold } = await scene(t, true)
  const roots = [placed(opaque)] as unknown as ClusterRoot<PageRec>[]
  const { roots: selectionRoots } = withWorldRoot({ roots, allPages: [], requestCount: 0 }, context)
  const session = (ends: AbortController) =>
    ({
      ...{ context, layout: { selectionRoots }, signal: ends.signal },
      run: { gate: { resourcesChanged: () => {} } },
      setup: { floorPages: 8, bootstrap: { length: 6 } },
    }) as unknown as Parameters<typeof coverHeldRoots>[0]
  const first = new AbortController(),
    second = new AbortController()
  coverHeldRoots(session(first), { holdCover: () => {} }, () => 58)
  coverHeldRoots(session(second), { holdCover: () => {} }, () => 30)
  first.abort()
  assert.equal(hold.cover.room?.(), 28, "the second session's room stands")
  second.abort()
  assert.equal(hold.cover.room, undefined)
})
