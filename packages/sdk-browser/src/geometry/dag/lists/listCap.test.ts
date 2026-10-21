// The readout's list, the cut's for its life: the largest one whose readout and kept ranks' tables
// one binding of the device holds, within the catalogue. A cut that lists more is read by its head
// (`../../cut/adoption/adoption.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { initialListCap } from './listCap.ts'
import { SELECTION_LIST_CAP, stagedOutputBytes } from '../layout.ts'
import { deviceListCap } from '../deviceListCap.ts'
import { keptRankRow } from '../keptRanks.ts'
import { createDagResources } from '../resources.ts'
import { createDagRuntime } from '../runtime/runtime.ts'
import { packDagSelection } from '../pack/pack.ts'
import { createSelectionUniforms } from '../../../gpu/core/selection.ts'
import { dagFixture } from '../../selection/dag.fixture.ts'
import { packed } from '../selection/selectionHelpers.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { idleKernels, writtenReadbacks } from '../differenceRig.fixture.ts'
import { hostStretches } from '../hostStretches.fixture.ts'

test('the list a device holds is the largest whose readout and kept ranks one binding holds', () => {
  const binding = 128 << 20,
    limits = { maxStorageBufferBindingSize: binding }
  const cap = deviceListCap(limits)
  // The readout of `cap` ranks and each kept list's table fit the binding; one rank more breaks one.
  assert.ok(stagedOutputBytes(cap) <= binding && keptRankRow(0, cap).size <= binding)
  assert.ok(stagedOutputBytes(cap + 1) > binding || keptRankRow(0, cap + 1).size > binding)
  assert.equal(initialListCap(limits, 2_000_000), SELECTION_LIST_CAP, 'a real device: as before')
  assert.equal(initialListCap(limits, 1000), 1000, 'never more than the catalogue')
  assert.equal(initialListCap({ maxStorageBufferBindingSize: stagedOutputBytes(9) }, 1000), 9)
})

/** Forty-eight placements of the fixture's primitive, cut on a list of `cap` ranks. */
async function cut(cap: number) {
  const [root] = packed(dagFixture()).roots
  const dag = packDagSelection(Array.from({ length: 48 }, () => root))
  const fake = fakeDevice({ kernel: idleKernels })
  // Every readback maps what the kernels would have written for `drawn` on the list in place.
  let drawn: number[] = []
  writtenReadbacks(fake.device, () => ({ cap, cut: { asked: drawn, drawn } }))
  // No table of open counts behind the lists: the readout is the lists alone (`../heldOpen.ts`).
  const resources = await createDagResources(fake.device, dag, null, cap, undefined, 0)
  assert.ok(resources)
  const selection = createDagRuntime(resources, hostStretches(resources.packed))
  const uniforms = createSelectionUniforms()
  /** One frame and its drain, whose readbacks hold `pages` under the list they were cut on. */
  const frame = async (pages: number[]) => {
    drawn = pages
    selection.dispatch(uniforms)
    await selection.flush()
    return selection.peek()
  }
  return { resources, frame }
}

test('a cut past the readout’s list is handed over by its head, the list never grown', async () => {
  const { resources, frame } = await cut(4)
  const output = resources.output
  const drawn = Array.from({ length: 10 }, (_, page) => page)
  assert.equal((await frame(drawn))?.result.truncated, true)
  assert.equal((await frame(drawn))?.result.truncated, true)
  assert.equal(resources.listCap, 4, 'the readout keeps its cap')
  assert.equal(resources.output, output, 'and its buffer')
})
