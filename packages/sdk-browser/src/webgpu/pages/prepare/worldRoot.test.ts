// The world DAG in the WebGPU cut: a partitioned world's DAG joins the catalogue as one more
// root, its pages read through the world's own source, each placed row linked to the object it
// draws. On the cook's world fixture, served.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows } from '../../../placement/rows.ts'
import { setRowCell } from '../../../partition/rowCells.ts'
import { linkWorldObject, takeLandedPages, withWorldRoot } from './worldRoot.ts'
import { placed, scene } from './worldRoot.fixture.ts'
import { createWebgpuPagesLayout } from './layout.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import type { WebgpuPagesSetup } from './setup.ts'

test('the world joins the catalogue as the last root, its requests ranked again', async (t) => {
  const { context, hold, opaque } = await scene(t)
  const roots = [placed(opaque)] as unknown as ClusterRoot<PageRec>[]
  const allPages = [...roots[0].pages]
  const collected = withWorldRoot({ roots, allPages, requestCount: 1 }, context)
  const world = collected.roots.at(-1)!
  assert.equal(world.pages.length, hold.drawn!.dag!.pages.length)
  assert.ok('origins' in world, 'the world DAG, packed last')
  assert.equal(collected.allPages.length, 1 + world.pages.length)
  assert.equal(world.pages[0].renderOrder, 4, 'drawn after every other')
  assert.ok(collected.requestCount > 1, 'its pages ranked among the requests')
})

test("a world page is read through the world's source, any other through the host", async (t) => {
  const { context, bin, table, reads } = await scene(t)
  const read = context.readGeometryPage!
  const { offset, bytes } = table.bundles[2]
  assert.deepEqual([...(await read('world-roots.bin#2:0'))], [...bin.slice(offset, offset + bytes)])
  await read('../../objects/page.bin')
  assert.deepEqual(reads, ['../../objects/page.bin'])
})

test('a placed row is linked to the object its cell places there, a parked one to none', async (t) => {
  const { context, opaque } = await scene(t)
  const rows = createPlacementRows(2),
    root = placed(opaque, rows) as unknown as ClusterRoot<PageRec>
  // The cut hears each link as `placeObject(rank, object)`.
  const links: [number, number][] = []
  const rt = {
    context,
    layout: { selectionRoots: [root] },
    run: {
      gpuSelection: { placeObject: (rank: number, object: number) => links.push([rank, object]) },
    },
  } as unknown as Parameters<typeof linkWorldObject>[0]
  const linked = () => (linkWorldObject(rt, 0), links.at(-1)![1])
  assert.equal(linked(), -1, 'no cell placed it')
  // Cell 1's first node, of mesh 0: the cell's first object, the table's rank 1.
  setRowCell(rows, 0, { cell: 1, node: 0 })
  assert.equal(linked(), 1)
  root.parked = true
  assert.equal(linked(), -1, 'parked')
})

test('the layout keeps the world DAG among the opaque roots, wherever it sits', async (t) => {
  const { context, opaque } = await scene(t)
  const blended = placed(opaque)
  blended.pages[0].transparent = true
  const opaquePlacement = placed(opaque)
  const roots = withWorldRoot(
    {
      roots: [opaquePlacement, blended] as unknown as ClusterRoot<PageRec>[],
      allPages: [],
      requestCount: 0,
    },
    context,
  ).roots
  const layout = createWebgpuPagesLayout({
    roots: [roots[2], roots[0], roots[1]],
    bootstrap: [],
    cap: 64,
    pageBytes: 64,
  } as unknown as WebgpuPagesSetup)
  // The world DAG first, as the scene listed it, the blended placement after every opaque one.
  assert.deepEqual(layout.selectionRoots, [roots[2], roots[0], roots[1]])
})

test('the pages a bundle read lands go to the free slots of the pool, unpinned, never past them', async (t) => {
  const { context, hold } = await scene(t)
  const loads: [string, unknown][] = [],
    resident = new Set(['held'])
  let inFlight = 0
  const cache = {
    stats: () => ({ slots: 3, residentPages: resident.size, loading: inFlight }),
    get: (address: string) => resident.has(address),
    load: (address: string, _signal: unknown, tier: unknown) => (
      loads.push([address, tier]),
      Promise.resolve()
    ),
  }
  const rt = {
    context,
    gpu: { cache },
    signal: new AbortController().signal,
    setup: { geometryUrls: new Map(['held', 'a', 'b', 'c', 'd', 'e'].map((url) => [url, url])) },
  }
  takeLandedPages(rt as unknown as Parameters<typeof takeLandedPages>[0])
  for (const tell of hold.drawn!.landed) tell(['held', 'unknown', 'a', 'b', 'c'])
  assert.deepEqual(loads, [
    ['a', undefined],
    ['b', undefined],
  ])
  // A load in flight takes the slot it lands in: a landed page counts it as taken.
  loads.length = 0
  inFlight = 1
  for (const tell of hold.drawn!.landed) tell(['d', 'e'])
  assert.deepEqual(loads, [['d', undefined]], 'one free slot, not two')
})
