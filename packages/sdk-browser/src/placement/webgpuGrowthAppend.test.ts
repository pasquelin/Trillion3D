// The roots a growth brings join the running GPU cut in place at the next frame entry
// (`startGrownCut`, `GpuSelection.appendRoots`). A cut made beside it for fewer roots, landed but not
// adopted yet, is released when the running cut takes the roots instead; and a running cut whose
// list is growing between two frames takes them at the next entry rather than a whole cut packed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementRows, growPlacementRows, placementWorld } from './rows.ts'
import { growthOf, startGrownCut, webgpuPlacementApi } from './webgpuGrowth.ts'
import type { GpuSelection } from '../gpu/core/selection.ts'
import { createSortedKeys } from '../webgpu/cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

/** A cut that counts what it took in place, and its releases; it takes nothing while growing. */
const fakeCut = () => ({
  growing: false,
  taken: [] as number[],
  disposed: 0,
  appendRoots(roots: readonly unknown[]) {
    if (this.growing) return false
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
  const cut = fakeCut()
  let rows = createPlacementRows(1)
  const root = { pages: [], placement: { rows, index: 0 }, world: placementWorld(rows, 0) }
  const rt = {
    run: { gpuSelection: cut, movedWorlds: createSortedKeys() },
    layout: { selectionRoots: [root] },
  } as unknown as WebgpuPagesRuntime
  const grow = () => {
    const to = growPlacementRows(rows, rows.capacity + 1)
    webgpuPlacementApi(rt).growPlacements(rows, to)
    rows = to
  }
  return { rt, cut, grow }
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
