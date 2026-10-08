// A view that keeps more clusters than the readout list holds: the list grows within the
// device and the cut stays on the GPU with every drawn cluster listed; past what the device
// holds, the cut coarsens (`listCoarsen.test.ts`), and only a cut that overflows at its coarsest
// is handed over truncated. The readbacks are written here, as the kernels would; that the
// kernels write them so is the GPU's to prove.
import test from 'node:test'
import assert from 'node:assert/strict'
import { coarsened, grownListCap, initialListCap } from './listCap.ts'
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

/** The coarsest factor a cut runs at: what any demand past the list rises to at most. */
const COARSEST = coarsened(1, Infinity, 1, true)

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

test('the factor rises past the device to fill half the list, falls once an eighth, else holds', () => {
  for (const demand of [0, 10, 900, 1000]) assert.equal(coarsened(1, demand, 1000, false), 1)
  const up = coarsened(1, 4000, 1000, true)
  assert.ok(Math.abs(up - Math.sqrt(8)) < 1e-12, 'the law D/f² puts the cut at half the list')
  assert.equal(coarsened(1, 600, 1000, true), Math.SQRT2, 'a step of √2 at least')
  assert.equal(COARSEST, 2 ** 16)
  assert.equal(coarsened(COARSEST, 1e12, 1000, true), COARSEST, 'and the coarsest at most')
  // Under the law, every demand the raised cut can meet within a factor 2 of it holds the factor.
  for (const demand of [250, 500, 1000]) assert.equal(coarsened(up, demand, 1000, false), up)
  assert.equal(coarsened(up, 125, 1000, false), up / 2, 'an eighth: back to half')
  assert.equal(coarsened(up, 0, 1000, false), 1, 'nothing asked: the view’s own threshold')
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
  assert.equal(selection.coarsen, COARSEST)
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
