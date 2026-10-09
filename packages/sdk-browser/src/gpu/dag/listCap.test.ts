// A view that keeps more clusters than the readout list holds: the list grows within the
// device and the cut stays on the GPU with every drawn cluster listed; past what the device
// holds, the cut coarsens (`listCoarsen.test.ts`), and only a cut that overflows at its coarsest
// is handed over truncated. The readbacks are written here, as the kernels would; that the
// kernels write them so is the GPU's to prove.
import test from 'node:test'
import assert from 'node:assert/strict'
import { grownListCap, initialListCap } from './listCap.ts'
import { SELECTION_LIST_CAP, stagedOutputBytes } from './layout.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { packDagSelection } from './selection.ts'
import { DAG_BINDING } from './shader/bindings.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { deviceListCap } from './deviceListCap.ts'
import { writtenReadbacks } from './differenceRig.fixture.ts'

test('the list a device holds is the largest whose readout one binding holds', () => {
  const limits = { maxStorageBufferBindingSize: 128 << 20 }
  const cap = deviceListCap(limits)
  assert.ok(stagedOutputBytes(cap) <= 128 << 20 && stagedOutputBytes(cap + 1) > 128 << 20)
  assert.equal(initialListCap(limits, 2_000_000), SELECTION_LIST_CAP, 'a real device: as before')
  assert.equal(initialListCap(limits, 1000), 1000, 'never more than the catalogue')
  assert.equal(initialListCap({ maxStorageBufferBindingSize: stagedOutputBytes(9) }, 1000), 9)
})

test('a truncated list doubles past what the cut asked, within the catalogue and the device', () => {
  const limits = { maxStorageBufferBindingSize: stagedOutputBytes(1000) }
  assert.equal(grownListCap(limits, 5000, 100, 150), 300)
  assert.equal(grownListCap(limits, 5000, 100, 30), 200)
  assert.equal(grownListCap(limits, 250, 100, 180), 250, 'the catalogue bounds it')
  assert.equal(grownListCap(limits, 5000, 100, 800), 1000, 'the device bounds it')
  assert.equal(grownListCap(limits, 5000, 100, 1200), undefined, 'past the device: stays')
  assert.equal(grownListCap(limits, 5000, 1000, 1200), undefined, 'already at the device')
})

/** Forty-eight placements of the fixture's primitive, cut on a list of `cap` ranks. */
async function cut(cap: number, options: Parameters<typeof fakeDevice>[0] = {}) {
  const [root] = packed(dagFixture()).roots
  const dag = packDagSelection(Array.from({ length: 48 }, () => root))
  const fake = fakeDevice(options)
  // Every readback maps what the kernels would have written for `drawn` on the list in place: the
  // drain cuts again on a grown list by itself (`runtime.ts`).
  let drawn: number[] = []
  // The list in place when a readback maps: it grows only with none in flight (`dispatch.ts`).
  let held = () => cap
  writtenReadbacks(fake.device, () => ({ cap: held(), cut: { asked: drawn, drawn } }))
  const resources = await createDagResources(fake.device, dag, null, cap)
  assert.ok(resources)
  held = () => resources.listCap
  const selection = createDagRuntime(resources)
  const uniforms = createSelectionUniforms()
  /** One frame and its drain, whose readbacks hold `pages` under the list they were cut on. */
  const frame = async (pages: number[]) => {
    drawn = pages
    selection.dispatch(uniforms)
    await selection.flush()
    return selection.peek()
  }
  return { fake, resources, selection, frame }
}

test('a cut past its list grows it and stays on the GPU, every drawn cluster listed', async () => {
  const { fake, resources, selection, frame } = await cut(4)
  const old = [resources.output, ...resources.readback]
  const drawn = Array.from({ length: 10 }, (_, page) => page)
  const grown = await frame(drawn)
  assert.equal(resources.listCap, 20, 'the drain grew the list and cut again on it')
  assert.equal(selection.coarsen, 1, 'within the device, the view’s own threshold')
  assert.deepEqual(grown?.result.drawablePageIds, drawn, 'no visible cluster dropped')
  assert.deepEqual(grown?.result.pageIds, drawn)
  assert.equal(grown?.result.truncated, false, 'the truncated readout is not handed over')
  assert.equal(resources.output.size, stagedOutputBytes(20))
  assert.ok(
    old.every((buffer) => fake.destroyed.includes(buffer)),
    'the old readout released',
  )
  assert.ok(!resources.buffers.some((buffer) => old.includes(buffer)))
  const outOf = (group: GPUBindGroup) =>
    [...(group as unknown as GPUBindGroupDescriptor).entries].find(
      (e) => e.binding === DAG_BINDING.out,
    )
  assert.equal(
    (outOf(resources.ranges[0].bindGroup)?.resource as GPUBufferBinding).buffer,
    resources.output,
  )
  const block = fake.writes.filter((w) => w.buffer === resources.uniforms).at(-1)!
  assert.equal(new Uint32Array(written(block).buffer)[52], 20, 'the kernels read the new cap')
})

test('a cut the device cannot list even at its coarsest is handed over by its head', async () => {
  // A binding this small splits every table in parts: the device binds them all, as the cut's
  // refusal asks of a real one (`deviceRefusal.ts`).
  const { resources, selection, frame } = await cut(4, {
    limits: {
      maxStorageBufferBindingSize: stagedOutputBytes(4),
      maxStorageBuffersPerShaderStage: 64,
    },
  })
  // Ten clusters whatever the threshold: the cut coarsens to its coarsest, then hands its head.
  const drawn = Array.from({ length: 10 }, (_, page) => page)
  assert.equal((await frame(drawn))?.result.truncated, true)
  assert.equal(selection.coarsen, 2 ** 16, 'the coarsest factor (`coarsening.ts`)')
  assert.equal((await frame(drawn))?.result.truncated, true)
  assert.equal(resources.listCap, 4, 'no growth past the device')
})

test('a larger list the device refuses keeps the old one and coarsens the cut instead', async () => {
  const refused = stagedOutputBytes(20)
  const { fake, resources, selection, frame } = await cut(4, {
    refuse: (descriptor) => (descriptor.size === refused ? 'oom' : undefined),
  })
  const old = [resources.output, ...resources.readback]
  const drawn = Array.from({ length: 10 }, (_, page) => page)
  assert.equal((await frame(drawn))?.result.truncated, true, 'at its coarsest, its head')
  assert.ok(selection.coarsen > 1, 'the cut coarsened past the list refused')
  assert.equal(resources.listCap, 4)
  assert.ok(!old.some((buffer) => fake.destroyed.includes(buffer)), 'the old readout kept')
  assert.equal(fake.scopes.length, 0, 'the scope closed')
  assert.equal((await frame(drawn))?.result.truncated, true, 'no second try')
})
