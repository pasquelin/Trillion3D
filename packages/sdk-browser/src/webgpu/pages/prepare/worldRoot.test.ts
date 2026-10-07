// The world DAG in the WebGPU cut: a partitioned world's DAG joins the catalogue as one more
// root, its pages read through the world's own source, each placed row linked to the object it
// draws; the CPU cut, which knows no link, never draws it. On the cook's world fixture, served.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { ClusterManifest, Primitive } from '../../../../../sdk-core/src/index.ts'
import { worldRootsDag } from '../../../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { served } from '../../../scene/worldRoots.fixture.ts'
import { openWorldRoots } from '../../../scene/worldRoots.ts'
import * as G from '../../../host/graph/graph.fixture.ts'
import { createPlacementRows } from '../../../placement/rows.ts'
import { setRowCell } from '../../../partition/rowCells.ts'
import { coverHeldRoots, linkWorldObject, readWorldOrGeometry, withWorldRoot } from './worldRoot.ts'
import { standAlone } from '../../../scene/worldSuperRoots.fixture.ts'
import { createWebgpuPagesLayout } from './layout.ts'
import type { EngineContext } from '../../../engine/types.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import type { WebgpuPagesSetup } from './setup.ts'

/** The served world, opened, and a scene whose one mesh wears its primitive; with `alone`, one
 *  lone object past its cells, its copies in bundle 1, which cell 0 holds. */
async function scene(t: Parameters<typeof served>[0], alone = false) {
  const cooked = worldRootsDag(),
    { clusters, groups } = cooked
  if (alone) standAlone(cooked, cooked.leaves, 1)
  const { manifest, bin, table } = served(t, undefined, false, { clusters, groups })
  const metadata = {
    ...manifest,
    primitives: [{ mesh: 0, primitive: 0, pass: 'clustered' }] as Primitive[],
  } as ClusterManifest
  const opaque = G.triangleMesh(G.standardSurface()),
    source = G.mesh()
  source.add(opaque)
  const reads: string[] = []
  const context = {
    metadata,
    source,
    associations: new Map([[opaque, { meshes: 0, primitives: 0 }]]),
    readGeometryPage: async (url: string) => (reads.push(url), new Uint8Array(4)),
  } as unknown as EngineContext
  const hold = (await openWorldRoots(metadata, 'http://world/'))!
  return { context, hold, bin, table, opaque, reads }
}

/** A placement's root: one opaque page of `mesh`, at row 0 of `rows`. */
function placed(mesh: unknown, rows = createPlacementRows(2)) {
  const page = { url: 'object', sourceMesh: mesh, transparent: false, renderOrder: 3 }
  return {
    world: { elements: new Float64Array(16) },
    pages: [page],
    placement: { rows, index: 0 },
  }
}

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
  const read = readWorldOrGeometry(context)
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
  setRowCell(rows, 0, { cell: 1, node: 0, meshes: Int32Array.of(0) })
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
