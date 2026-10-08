// A growth in place appends its new placements into the room the cut's packing kept (`pack.ts`):
// the tables then read word for word as a packing of every root at that capacity, and the GPU cut
// over them selects what a cut made over every root selects. Past the room, or for a primitive the
// packing does not hold, nothing is appended: the caller packs every root again.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { appendDagRoots, dagRootCounts, packDagSelection, type DagCapacity } from './pack.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { createGpuDagSelection } from './selection.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { kernelUniforms } from './selectionHelpers.fixture.ts'
import { frontCamera } from '../../page/selection/dag.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { DagRoot } from './types.ts'

/** Five placements of one pyramid along x, the last three parked as a growth leaves its rows. */
function scene() {
  const pages = scenePages(256, 4)
  const worlds = [0, 1, 2, 3, 4].map((k) => new G.Matrix4().makeTranslation(k * 3, 0, 0))
  const roots: DagRoot[] = sceneRoots(pages, worlds, true)
  const counts = dagRootCounts(roots)
  const capacity: DagCapacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 8 }
  return { roots, counts, capacity }
}

const TABLES = [
  'clusters',
  'nodes',
  'pageCones',
  'worlds',
  'worldStretch',
  'rootNodes',
  'rootBases',
  'mark',
  'recordShift',
  'levelSizes',
] as const

test('roots appended into the room read as a packing of every root at that capacity', () => {
  const { roots, counts, capacity } = scene()
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  const added = appendDagRoots(grown, roots.slice(2))
  const per = counts.pages / roots.length,
    nodes = counts.nodes / roots.length
  assert.deepEqual(added, {
    pages: [2 * per, counts.pages],
    nodes: [2 * nodes, counts.nodes],
    worlds: [2, 5],
    tree: { nodes: [], members: [0, 0] },
  })
  for (const table of TABLES) assert.deepEqual(grown[table], whole[table], table)
  assert.deepEqual(grown.live, whole.live)
  assert.deepEqual(grown.live, { pages: counts.pages, nodes: counts.nodes, worlds: 5 })
  assert.deepEqual(
    [grown.pageCount, grown.nodeCount, grown.worldCount, grown.recordCount, grown.rootCount],
    [whole.pageCount, whole.nodeCount, whole.worldCount, whole.recordCount, whole.rootCount],
  )
  assert.deepEqual(grown.cutLinks, whole.cutLinks)
  for (let page = 0; page < capacity.pages; page++)
    assert.equal(grown.pageUrlOf(page), whole.pageUrlOf(page), `page ${page}`)
  assert.equal(grown.pageUrlOf(counts.pages), undefined, 'the room names no page')
})

test('roots past the room, or of a primitive the packing does not hold, are not appended', () => {
  const { roots, capacity } = scene()
  const tight = packDagSelection(roots.slice(0, 2), { ...capacity, worlds: 3 })
  assert.equal(appendDagRoots(tight, roots.slice(2)), undefined, 'two placements too many')
  const other = sceneRoots(scenePages(64, 3), [new G.Matrix4()], true)
  assert.equal(appendDagRoots(tight, other), undefined, 'a primitive it does not hold')
  assert.deepEqual(tight.live, packDagSelection(roots.slice(0, 2)).live, 'nothing moved')
})

test('a packing without a capacity is the exact one and keeps no room', () => {
  const { roots, counts } = scene()
  const exact = packDagSelection(roots)
  assert.deepEqual(
    [exact.pageCount, exact.nodeCount, exact.worldCount],
    [counts.pages, counts.nodes, roots.length],
  )
  assert.equal(exact.shared, undefined)
  assert.equal(appendDagRoots(exact, roots.slice(0, 1)), undefined)
})

test('the GPU cut over the roots appended in place selects what a cut over every root does', async () => {
  installGpuGlobals()
  const { roots, capacity } = scene()
  const cutOf = async (packed: ReturnType<typeof packDagSelection>) => {
    const selection = await createGpuDagSelection(mockDagDevice(packed).device, packed)
    assert.ok(selection)
    return selection
  }
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  // The render frame set before the reference is made: its worlds go up rebased. From 20 units
  // the view holds the five placements, appended ones included, and a 1 px cut stops on them: the
  // finest pages' own error (0.01) is under a pixel there — from 5 units it is past one at every
  // level, and no page is cut at all.
  const uniforms = kernelUniforms(whole, roots, frontCamera(20), 1)
  const [reference, appended] = [await cutOf(whole), await cutOf(grown)]
  const held = grown.live!.pages
  assert.equal(appended.pageCount, held, 'the pages its roots hold')
  assert.equal(appended.appendRoots(roots.slice(2)), true)
  assert.equal(appended.pageCount, whole.live!.pages)
  // The same worlds, one placement each, as the session sends them every image: the append sent
  // them already, nothing moves.
  assert.equal(appended.updateWorlds(whole.worlds.slice()), false)
  const results = []
  for (const selection of [reference, appended]) {
    selection.dispatch(uniforms)
    results.push((await selection.flush())?.pageIds.slice().sort((a, b) => a - b))
  }
  assert.ok(results[0]!.length > 0, 'the view asks pages')
  assert.deepEqual(results[1], results[0])
  assert.ok(
    results[1]!.some((page) => page >= held),
    'the placements appended are cut too',
  )
  reference.dispose()
  appended.dispose()
})

test('roots appended under a still eye are brought to it before the next cut', async () => {
  installGpuGlobals()
  const { roots, capacity } = scene()
  const whole = packDagSelection(roots, capacity),
    grown = packDagSelection(roots.slice(0, 2), capacity)
  const uniforms = kernelUniforms(whole, roots, frontCamera(20), 1)
  const cut = async (packed: ReturnType<typeof packDagSelection>, append = false) => {
    const selection = (await createGpuDagSelection(mockDagDevice(packed).device, packed))!
    selection.dispatch(uniforms)
    await selection.flush()
    // The eye has not moved: only the worlds the append wrote, absolute, ask the rebase.
    if (append) assert.equal(selection.appendRoots(roots.slice(2)), true)
    selection.dispatch(uniforms)
    const pages = (await selection.flush())?.pageIds.slice().sort((a, b) => a - b)
    selection.dispose()
    return pages
  }
  const [reference, appended] = [await cut(whole), await cut(grown, true)]
  assert.ok(reference!.length > 0)
  assert.deepEqual(appended, reference)
})
