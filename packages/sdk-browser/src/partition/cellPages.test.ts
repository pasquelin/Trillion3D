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
// fails keeps both wanted until the plan asks it again, once its wait is over, or the cell leaves.
test('a failed hold keeps its pages wanted until the plan asks again, at the priority it gives then', async (t) => {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const { pages, counts, land } = countedPages(new Set())
  const world = { held: 0, fails: 1, priorities: [] as (number | undefined)[] }
  const held = createCellPages(pages, cell(['x']), {
    async hold(_, asked) {
      world.held++
      world.priorities.push(asked?.priority)
      await Promise.resolve()
      if (world.fails-- > 0) throw Object.assign(new Error('world read failed'), { due: 500 })
    },
    release: () => void world.held--,
  })
  held.hold(0, 1.5)
  land()
  await settled(held)
  assert.deepEqual([counts.get('x'), world.held, held.held()], [1, 1, 0], 'wanted, not held')
  await settled(held)
  assert.equal(held.held(), 0, 'never asked again by itself, frame after frame')
  held.retry(() => 1.25, now)
  assert.equal(world.priorities.length, 1, 'not before its wait is over')
  assert.equal(held.due(), 500, 'half a second after its first failure')
  now = 500
  held.retry(() => 1.25, now)
  await settled(held)
  assert.deepEqual(
    [counts.get('x'), world.held, held.held()],
    [1, 1, 1],
    'held; the failed hold let go',
  )
  assert.deepEqual(world.priorities, [1.5, 1.25], 'at the priority the plan gives it now')
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

test('a failed cell that leaves takes its wait with it: the earliest is the next one', async () => {
  const { pages, land } = countedPages(new Set())
  const waits = [500, 2000]
  const held = createCellPages(pages, cell([]), {
    async hold(cell) {
      throw Object.assign(new Error('refused'), { due: waits[cell] })
    },
    release() {},
  })
  held.hold(0)
  held.hold(1)
  land()
  await settled(held)
  assert.equal(held.due(), 500)
  held.release(0)
  assert.equal(held.due(), 2000, 'the frame wakes for a cell still waiting')
})
