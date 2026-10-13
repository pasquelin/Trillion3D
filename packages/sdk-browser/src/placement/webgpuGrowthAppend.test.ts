// The roots a growth brings join the running GPU cut in place at the next frame entry
// (`startGrownCut`, `GpuSelection.appendRoots`). A cut made beside it for fewer roots, landed but not
// adopted yet, is released when the running cut takes the roots instead; and a running cut whose
// list is growing between two frames takes them at the next entry rather than a whole cut packed.
// The worlds the host sends hold the appended roots' at once: a host walk before their adoption
// compares them as the cut holds them, never as zeros.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows, growPlacementRows, placementWorld } from './rows.ts'
import { sceneRoots, scenePages } from '../gpu/dag/cutFrontierScene.fixture.ts'
import { growthOf, startGrownCut, webgpuPlacementApi } from './webgpuGrowth.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import { createSortedKeys } from '../webgpu/cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** A cut that counts what it took in place, and its releases; it takes nothing while growing. */
const fakeCut = () => ({
  growing: false,
  taken: [] as number[],
  disposed: 0,
  full: false,
  appendRoots(roots: readonly unknown[]) {
    if (this.growing || this.full) return false
    this.taken.push(roots.length)
    return true
  },
  dispose() {
    this.disposed++
  },
})

/** A session holding one placed root on a one-row buffer, its running cut, and `grow`: the buffer
 *  grown by one row, as an owner hands it (`growWebgpuPlacements`). The session reads nothing else
 *  while the running cut takes the roots: a cut made beside it would read the row cache. */
function session() {
  const refusals: string[][] = []
  const cut = fakeCut()
  let rows = createPlacementRows(1)
  const [held] = sceneRoots(scenePages(4, 2), [placementWorld(rows, 0)])
  const root = { ...held, placement: { rows, index: 0 }, world: placementWorld(rows, 0) }
  const rt = {
    run: { gpuSelection: cut, movedWorlds: createSortedKeys() },
    layout: { selectionRoots: [root], worldUpdates: new Float32Array(4 * 16) },
    // No blended surface and no deformation: nothing else reads the rows.
    setup: { blendCopies: [], pagedBlendCopies: new Map(), deformationBlocks: [] },
    blendState: { blendGpu: [] },
    vis: {},
    gpu: { device: {} },
    signal: new AbortController().signal,
    context: { onContentRefused: (what: string, reason: string) => refusals.push([what, reason]) },
  } as unknown as WebgpuPagesRuntime
  const grow = () => {
    const to = growPlacementRows(rows, rows.capacity + 1)
    webgpuPlacementApi(rt).growPlacements(rows, to)
    rows = to
  }
  return { rt, cut, grow, refusals }
}

test('a made cut not adopted is released when the running cut takes the roots in place', () => {
  const { rt, cut, grow } = session()
  grow()
  // The state a cut made beside the running one leaves once it lands (`makeCut`).
  const made = fakeCut(),
    growth = growthOf(rt)!
  growth.asked = false
  growth.ready = { cut: made as unknown as GpuSelection, roots: 2, moved: new Set() }
  grow()
  startGrownCut(rt)
  assert.equal(made.disposed, 1, 'the made cut is released, never left behind')
  assert.equal(growth.ready?.cut, cut as unknown as GpuSelection, 'the running cut is ready')
  assert.equal(growth.ready?.inPlace, true)
  assert.equal(cut.disposed, 0)
})

test('a cut whose list grows takes the roots at the next frame entry, no cut made', () => {
  const { rt, cut, grow } = session()
  grow()
  cut.growing = true
  startGrownCut(rt)
  const growth = growthOf(rt)!
  assert.equal(growth.making, undefined, 'no cut packed beside it')
  assert.equal(growth.asked, true, 'asked again at the next entry')
  assert.deepEqual(cut.taken, [])
  cut.growing = false
  startGrownCut(rt)
  assert.deepEqual(cut.taken, [growth.roots.length], 'taken in place once the list grew')
  assert.equal(growth.ready?.inPlace, true)
  assert.equal(growth.asked, false)
})

test('the roots taken in place join the worlds the host sends, at their ranks', () => {
  const { rt, grow } = session()
  grow()
  const growth = growthOf(rt)!
  const [root] = growth.roots as unknown as { world: { elements: ArrayLike<number> } }[]
  ;(root.world.elements as Float64Array)[12] = 7.5
  startGrownCut(rt)
  assert.deepEqual(
    [...rt.layout.worldUpdates.subarray(16, 32)],
    [...Float32Array.from(root.world.elements)],
    'rank 1 holds its world',
  )
})

test('a cut the device refuses is said by name: the running cut stays, the session is not lost', async () => {
  const { rt, cut, grow, refusals } = session()
  Object.assign(rt.layout, { rows: { logTouched() {} }, packedPages: [] })
  ;(rt.run as { lost?: boolean }).lost = false
  cut.full = true
  grow()
  startGrownCut(rt)
  await growthOf(rt)!.making
  assert.equal(refusals.length, 1, 'said once, by name')
  assert.match(refusals[0][1], /refused the cut/)
  assert.equal(rt.run.gpuSelection, cut as unknown as GpuSelection, 'the running cut is kept')
  assert.equal(rt.run.lost, false, 'no lost device: nothing reopens')
  assert.equal(growthOf(rt)!.ready, undefined)
  assert.equal(cut.disposed, 0)
})
