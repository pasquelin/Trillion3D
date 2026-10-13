// The open counts placements hold follow the row cache (`heldOpen.ts`, `queueGrowth.ts`): sized from
// the rows it holds, grown on the readout's growth path once it grows, every entry placed again. A
// table too small refuses nothing — no row, no residency —: an entry it cannot place leaves its
// node's count, and the cut is the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts'
import { dagFixture, frontCamera } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { createDagReadiness } from './readiness.ts'
import { pageResidency } from './readiness.fixture.ts'

/** Fifty placements of the grouped fixture on a grid, every page resident — each placement's
 *  open counts its own —, and an eye over them. */
function scene() {
  const [root] = packed(dagFixture()).roots
  const roots = Array.from({ length: 50 }, (_, w) => ({
    ...root,
    world: new G.Matrix4().setPosition((w % 10) * 5 - 25, 0, -Math.floor(w / 10) * 5),
  }))
  const dag = packDagSelection(roots)
  const resident = new Uint32Array(dag.pageCount).fill(1)
  return { dag, resident, uniforms: kernelUniforms(dag, roots, frontCamera(30), 1) }
}

/** The entries a table large enough for every count holds, on `dag`'s own residency. */
function allEntries(dag: ReturnType<typeof scene>['dag'], resident: Uint32Array) {
  const packed = { ...dag }
  createDagReadiness(packed, 1 << 16).apply(pageResidency(resident))
  return packed.heldOpen!.entries
}

test('the open counts follow the row cache: a small table refuses nothing, a grown one holds every count', async () => {
  installGpuGlobals()
  const { dag, resident, uniforms } = scene()
  const every = allEntries(dag, resident)
  const selection = (await createGpuDagSelection(mockDagDevice(dag).device, dag, { rows: 4 }))!
  assert.ok(selection.updateResidency(pageResidency(resident)), 'the residency is taken whole')
  const held = dag.heldOpen!
  assert.ok(held.slots < 2 * every && held.dropped > 0, 'four rows: a table short of the counts')
  selection.dispatch(uniforms)
  const small = (await selection.flush())?.drawablePageIds?.toSorted((a, b) => a - b)
  assert.ok(small && small.length > 0, 'a cut that draws nothing proves nothing')
  // The row cache grows: the table follows it before the next cut, every count placed again.
  selection.followRows!(4 * every)
  selection.dispatch({ ...uniforms, pixelError: uniforms.pixelError })
  const grown = (await selection.flush())?.drawablePageIds?.toSorted((a, b) => a - b)
  assert.ok(held.slots >= 2 * every, `${held.slots} slots for ${every} counts`)
  assert.equal(held.entries, every, 'every count held')
  assert.deepEqual(grown, small, 'the same cut: the table only spares work')
  selection.dispose()
})
