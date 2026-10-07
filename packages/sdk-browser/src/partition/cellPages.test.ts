import test from 'node:test'
import assert from 'node:assert/strict'
import type { ManifestPages } from '../../../sdk-core/src/manifest/paged.ts'
import { createCellPages } from './cellPages.ts'

/** Pages held by a count, as `openPagedManifest` holds them: each hold released once, landed or
 *  not; `fail` names the slots whose read fails, `landing` settles the reads asked so far. */
function countedPages(fail: ReadonlySet<string>) {
  const counts = new Map<string, number>()
  let land = () => {}
  const landing = new Promise<void>((resolve) => (land = resolve))
  const pages = {
    primitives: [],
    changes: 0,
    async hold(slots) {
      for (const slot of slots) counts.set(slot, (counts.get(slot) ?? 0) + 1)
      await landing
      if (slots.some((slot) => fail.has(slot))) throw new Error('read failed')
    },
    release(slots) {
      for (const slot of slots) counts.set(slot, counts.get(slot)! - 1)
    },
  } satisfies ManifestPages
  return { pages, counts, land }
}

/** Each cell's mesh pages, `lists[cell]`. */
const cell =
  (...lists: string[][]) =>
  (at: number) =>
    lists[at]

/** Until no hold of `held` is on its way, without a frame's time passing. */
async function settled(held: ReturnType<typeof createCellPages>) {
  for (let asked = held.reads(); asked.length; asked = held.reads()) await Promise.all(asked)
}

// A cell that leaves while its read is in flight, the read then failing, drops no page
// another placed cell still holds.
test('a cell that leaves mid-read releases its pages once, its read failing or not', async () => {
  const { pages, counts, land } = countedPages(new Set(['y']))
  const held = createCellPages(pages, cell(['x', 'y'], ['x']))
  held.hold(0)
  held.hold(1)
  held.release(0)
  land()
  await settled(held)
  assert.deepEqual([counts.get('x'), counts.get('y'), held.held()], [1, 0, 1])
})

test('a cell that leaves and comes back mid-read releases its pages once each', async () => {
  const { pages, counts, land } = countedPages(new Set())
  const held = createCellPages(pages, cell(['x']))
  held.hold(0)
  held.release(0)
  held.hold(0)
  land()
  await settled(held)
  assert.deepEqual([counts.get('x'), held.held()], [1, 1])
  held.release(0)
  assert.deepEqual([counts.get('x'), held.held()], [0, 0])
})

test('a cell that leaves mid-read releases its pages once they land', async () => {
  const { pages, counts, land } = countedPages(new Set())
  const held = createCellPages(pages, cell(['x']))
  held.hold(0)
  held.release(0)
  land()
  await settled(held)
  assert.deepEqual([counts.get('x'), held.held()], [0, 0])
})

// A placed cell also holds the world bundles its objects' roots depend on. A hold whose world read
// fails for good keeps both wanted till the cell leaves, and no one asks it again meanwhile.
test('a failed hold keeps its pages wanted while its cell is placed, never asked again', async () => {
  const { pages, counts, land } = countedPages(new Set())
  const world = { held: 0, asked: 0 }
  const held = createCellPages(pages, cell(['x']), {
    async hold() {
      world.held++
      world.asked++
      await Promise.resolve()
      throw new Error('PAGE_STREAM_FAILED: refused for good')
    },
    release: () => void world.held--,
  })
  held.hold(0, 1.5)
  land()
  await settled(held)
  held.hold(0, 1.25) // a later frame places it again
  await settled(held)
  assert.deepEqual([counts.get('x'), world.held, world.asked], [1, 1, 1], 'wanted, asked once')
  held.release(0)
  assert.deepEqual([counts.get('x'), world.held], [0, 0])
})

test('a cell whose hold failed lets its pages go when it leaves', async () => {
  const { pages, counts, land } = countedPages(new Set(['x']))
  const held = createCellPages(pages, cell(['x']))
  held.hold(0)
  land()
  await settled(held)
  assert.equal(counts.get('x'), 1, 'the failed page still wanted')
  held.release(0)
  assert.equal(counts.get('x'), 0)
})

test('a cell that leaves while its hold reads lets its world reads go at once', () => {
  const asked: { signal?: AbortSignal; priority?: number }[] = []
  const held = createCellPages(undefined, () => [], {
    hold: (_, options) => (asked.push(options!), new Promise<void>(() => {})),
    release() {},
  })
  held.hold(3, 1.25)
  held.release(3)
  assert.deepEqual([asked[0].priority, asked[0].signal!.aborted], [1.25, true])
})
