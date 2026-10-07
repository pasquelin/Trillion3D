import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { dagPageUrls } from './pack.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { gatedDag, kernelUniforms, packed } from './selectionHelpers.fixture.ts'

test("a shared command buffer is the caller's to submit, and abandoning it gives everything back", async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const { device } = mockDagDevice(dag)
  const queue = (device as unknown as { queue: { submit: () => void } }).queue,
    submitted = queue.submit
  let submits = 0
  queue.submit = () => {
    submits++
    submitted.call(queue)
  }
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  const abandoned = selection.dispatch(uniforms, device.createCommandEncoder())
  assert.equal(typeof abandoned, 'function', 'a shared buffer hands back its settlement')
  assert.equal(submits, 0, 'the selection does not submit a buffer it does not own')
  abandoned!(false)
  // Nothing ran, so nothing may be remembered as run: the next image recomputes and reads back.
  const settle = selection.dispatch(uniforms, device.createCommandEncoder())
  assert.equal(typeof settle, 'function')
  settle!(true)
  assert.equal((await selection.flush())?.pageIds.length, 4)
  assert.equal(submits, 0, 'the image submits its own buffer')
  selection.dispose()
  fixture.geometry.dispose()
})

test('unchanged uniforms skip a second GPU dispatch', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const { device, uniformWrites } = mockDagDevice(dag)
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  selection.dispatch(uniforms)
  await selection.flush()
  const afterFirst = uniformWrites()
  selection.dispatch(uniforms)
  await selection.flush()
  assert.equal(uniformWrites(), afterFirst)
  selection.dispose()
  fixture.geometry.dispose()
})

test('the resident mask recomputes for residency changes with an unchanged camera', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const { device, uniformWrites } = mockDagDevice(dag)
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  const mask = () =>
    [
      ...new Uint32Array(
        (selection.maskBuffer as unknown as { data: Uint8Array }).data.buffer,
      ).slice(selection.maskOffset, selection.maskOffset + dag.pageCount),
    ]
      .flatMap((flag, id) => (flag ? [dag.pageUrlOf(id)] : []))
      .sort()
  selection.updateResidency(
    Uint32Array.from(dagPageUrls(dag).map((url) => (url === 'root' ? 1 : 0))),
  )
  selection.dispatch(uniforms)
  assert.deepEqual(
    (await selection.flush())?.drawablePageIds?.map((id) => dag.pageUrlOf(id)),
    ['root'],
  )
  assert.deepEqual(mask(), ['root'])
  selection.updateResidency(new Uint32Array(dag.pageCount).fill(1))
  assert.equal(selection.peek(), null)
  selection.dispatch(uniforms)
  assert.deepEqual(
    (await selection.flush())?.drawablePageIds?.map((id) => dag.pageUrlOf(id)).sort(),
    ['leaf0', 'leaf1', 'leaf2', 'leaf3'],
  )
  assert.equal(uniformWrites(), 2)
  assert.deepEqual(mask(), ['leaf0', 'leaf1', 'leaf2', 'leaf3'])
  selection.dispose()
  fixture.geometry.dispose()
})

// #1483: a mapping the device refuses reads nothing, and the next dispatch copies the cut again; a
// lost device says so on its own (`device.lost`), never a readback.
test('a failed readback is read again at the next dispatch, the selection kept', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const gpu = mockDagDevice(dag, { failMap: true })
  const selection = await createGpuDagSelection(gpu.device, dag)
  assert.ok(selection)
  selection.dispatch(uniforms)
  assert.equal(await selection.flush(), null)
  assert.equal(selection.failed(), false, 'the selection stays')
  assert.equal(selection.peek(), null, 'nothing read')
  const copies = gpu.readbackCopies()
  selection.dispatch(uniforms)
  assert.equal(gpu.readbackCopies(), copies + 1, 'the same cut copied again')
  selection.dispose()
  fixture.geometry.dispose()
})

test('readback from an older resident cut cannot restore an invalidated drawable mask', async () => {
  const { release, fixture, dag, uniforms, device } = gatedDag()
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  selection.updateResidency(
    Uint32Array.from(dagPageUrls(dag).map((url) => (url === 'root' ? 1 : 0))),
  )
  selection.dispatch(uniforms)
  selection.updateResidency(new Uint32Array(dag.pageCount).fill(1))
  release()
  assert.equal(await selection.flush(), null)
  assert.equal(selection.peek(), null)
  selection.dispose()
  fixture.geometry.dispose()
})
