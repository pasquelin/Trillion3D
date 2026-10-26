// The open counts placements hold follow the visible list's room (`heldOpen.ts`, `queueGrowth.ts`):
// sized from the clusters it holds room for, grown on the readout's growth path once it grows, every
// entry placed again. A table too small refuses nothing — no cluster, no residency —: an entry it
// cannot place leaves its node's count, and the cut is the same.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { createGpuDagSelection } from './selection/selection.ts'
import { packDagSelection } from './pack/pack.ts'
import { kernelUniforms, packed } from './selection/selectionHelpers.fixture.ts'
import { dagFixture, frontCamera } from '../selection/dag.fixture.ts'
import { mockDagDevice } from './selection/selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { createDagReadiness } from './readiness.ts'
import { pageResidency } from './readiness.fixture.ts'
import { hostStretches } from './hostStretches.fixture.ts'

/** Fifty placements of the grouped fixture on a grid, every page resident — each placement's
 *  open counts its own —, and an eye over them. */
function scene() {
  const [root] = packed(dagFixture()).roots
  const roots = Array.from({ length: 50 }, (_, w) => ({
    ...root,
    world: new Matrix4().setPosition((w % 10) * 5 - 25, 0, -Math.floor(w / 10) * 5),
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

/** A cut over `scene()` whose open counts are sized for a visible list of `rows` records: the
 *  counts' table and the clusters it draws. */
async function cutWith(rows: number) {
  installGpuGlobals()
  const { dag, resident, uniforms } = scene()
  const selection = (await createGpuDagSelection(mockDagDevice(dag).device, dag, {
    roots: hostStretches(dag),
    rows,
  }))!
  assert.ok(selection.updateResidency(pageResidency(resident)), 'the residency is taken whole')
  selection.dispatch(uniforms)
  const drawn = (await selection.flush())?.drawablePageIds?.toSorted((a, b) => a - b)
  selection.dispose()
  return { held: dag.heldOpen!, drawn }
}

test('the open counts follow the visible list’s room: a small table refuses nothing, one sized for the room holds every count', async () => {
  const { dag, resident } = scene()
  const every = allEntries(dag, resident)
  const small = await cutWith(4)
  assert.ok(
    small.held.slots < 2 * every && small.held.dropped > 0,
    'four clusters: a table short of the counts',
  )
  assert.ok(small.drawn && small.drawn.length > 0, 'a cut that draws nothing proves nothing')
  const grown = await cutWith(4 * every)
  assert.ok(grown.held.slots >= 2 * every, `${grown.held.slots} slots for ${every} counts`)
  assert.equal(grown.held.entries, every, 'every count held')
  assert.deepEqual(grown.drawn, small.drawn, 'the same cut: the table only spares work')
})
