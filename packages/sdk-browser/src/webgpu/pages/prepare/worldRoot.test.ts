// The world HLOD in the WebGPU cut: a partitioned world's DAG joins the catalogue as one more
// root, its pages read through the world's own source, each placed row linked to the HLOD 0 cell it
// lies in. On the cook's world fixture, served.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows } from '../../../placement/rows.ts'
import { setRowCell } from '../../../partition/rowCells.ts'
import { linkWorldCell, linkWorldCells, withWorldRoot } from './worldRoot.ts'
import { placed, scene } from './worldRoot.fixture.ts'
import { pageOf } from '../../../scene/worldRoots.fixture.ts'
import { bundlePageRanges } from '../../../../../sdk-core/src/manifest/worldRoots.ts'
import { drawSourceOf } from '../../../page/selection/drawSource.ts'
import * as G from '../../../host/graph/graph.fixture.ts'
import { createWebgpuPagesLayout } from './layout.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import type { WebgpuPagesSetup } from './setup.ts'

test('the world joins the catalogue as the last root, its requests ranked again', async (t) => {
  const { context, hold, opaque } = await scene(t)
  const roots = [placed(opaque)] as unknown as ClusterRoot<PageRec>[]
  const allPages = [...roots[0].pages]
  const collected = withWorldRoot({ roots, allPages, requests: new Map() }, context)
  const world = collected.roots.at(-1)!
  assert.equal(world.pages.length, hold.dag!.pages.length)
  assert.ok('hlod' in world, 'the world DAG, packed last')
  assert.equal(collected.allPages.length, 1 + world.pages.length)
  assert.equal(world.pages[0].renderOrder, 4, 'drawn after every other')
  assert.ok(collected.requests.size > 1, 'its pages ranked among the requests')
})

test("a world page is a slice of its bundle, read by the session's one reader", async (t) => {
  const { context, bin, table } = await scene(t)
  const at = table.bundles[2].offset + bundlePageRanges(table, 2)[0].offset,
    { bytes } = bundlePageRanges(table, 2)[0]
  const read = await context.readGeometryPage!(pageOf(table, 2), undefined, undefined)
  assert.deepEqual([...read], [...bin.slice(at, at + bytes)])
})

test('a placed row is linked to the HLOD 0 cell it lies in, a parked one to none', async (t) => {
  const { context, opaque } = await scene(t)
  const rows = createPlacementRows(2),
    root = placed(opaque, rows) as unknown as ClusterRoot<PageRec>
  // The cut hears each link as `placeInCell(rank, cell, instance)`.
  const links: [number, number, number][] = []
  const rt = {
    context,
    layout: { selectionRoots: [root] },
    run: {
      gpuSelection: {
        world: {},
        placeInCell: (rank: number, cell: number, instance: number) =>
          links.push([rank, cell, instance]),
      },
    },
  } as unknown as Parameters<typeof linkWorldCell>[0]
  const linked = () => (linkWorldCell(rt, 0), links.at(-1)!)
  assert.deepEqual(linked(), [0, -1, 0], 'no cell placed it')
  setRowCell(rows, 0, { cell: 1, node: 0, instance: 1, hlod: 2, proxy: false })
  assert.deepEqual(linked(), [0, 2, 1], 'its HLOD 0 cell, in its model\u2019s instance')
  root.parked = true
  assert.deepEqual(linked(), [0, -1, 0], 'parked')
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
      requests: new Map(),
    },
    context,
  ).roots
  const layout = createWebgpuPagesLayout(
    {
      roots: [roots[2], roots[0], roots[1]],
      bootstrap: [],
      cap: 64,
      pageBytes: 64,
    } as unknown as WebgpuPagesSetup,
    undefined,
    () => -1,
  )
  // The world DAG first, as the scene listed it, the blended placement after every opaque one.
  assert.deepEqual(layout.selectionRoots, [roots[2], roots[0], roots[1]])
})

test('a cut that packs no world DAG links no placement, at its adoption or a row moved', () => {
  let told = 0
  const roots = Array.from(
    { length: 1000 },
    () => ({ pages: [{}], placement: {} }) as unknown as ClusterRoot<PageRec>,
  )
  const cut = { world: undefined, placeInCell: () => void told++ } as never
  linkWorldCells(cut, roots)
  linkWorldCell({ layout: { selectionRoots: roots }, run: { gpuSelection: cut } }, 7)
  assert.equal(told, 0, 'nothing linked')
})

test('a world placed by its model is posed by its row, parked with it', async (t) => {
  const { context, hold } = await scene(t)
  const seven = drawSourceOf(G.triangleMesh(G.standardSurface()), { meshes: 7, primitives: 0 })
  const root = placed(seven) as unknown as ClusterRoot<PageRec>
  const pose = createPlacementRows(1)
  pose.live[0] = 1
  pose.matrices.set([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1])
  hold.drawnAs({ pose: { rows: pose } })
  const posed = () =>
    withWorldRoot({ roots: [root], allPages: [], requests: new Map() }, context).roots.at(-1)!
  assert.equal(posed().world.elements[12], 5, 'drawn at its model\u2019s world')
  assert.equal(posed().parked, false)
  pose.live[0] = 0
  assert.equal(posed().parked, true, 'parked with its model')
})
