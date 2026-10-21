import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuDagSelection } from './selection.ts'
import { packDagSelection } from '../pack/pack.ts'
import { dagFixture, wideCamera } from '../../selection/dag.fixture.ts'
import { dagCulling } from '../../selection/helpers.fixture.ts'
import { cpuUrls, kernelUniforms, kernelUrls, packed } from './selectionHelpers.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { dagPageUrls } from '../pack/pack.fixture.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { pageResidency, ruleResidency } from '../readiness.fixture.ts'
import { evaluateDagSelectionKernel } from '../oracle/oracle.fixture.ts'
import { hostStretches } from '../hostStretches.fixture.ts'

test('the GPU flat cut selects the same single cluster per chain as the CPU cut', () => {
  const plain = dagFixture(),
    accelerated = dagFixture()
  accelerated.metadata.primitives[0].culling = dagCulling()
  const cam = wideCamera()
  const chains = [
    ['leaf0', 'mid-left', 'root'],
    ['leaf1', 'mid-left', 'root'],
    ['leaf2', 'mid-right', 'root'],
    ['leaf3', 'mid-right', 'root'],
  ]
  for (const pixelError of [0, 1, 3.4, 3.6, 20, 60, 200, 1e6]) {
    const cpu = cpuUrls(plain, pixelError, cam)
    assert.deepEqual(kernelUrls(plain, pixelError, cam).urls, cpu, `pixelError ${pixelError}`)
    // The culling hierarchy is only an early reject: it must not change the selected set.
    assert.deepEqual(
      kernelUrls(accelerated, pixelError, cam).urls,
      cpu,
      `accelerated pixelError ${pixelError}`,
    )
    const shown = new Set(cpu)
    for (const chain of chains)
      assert.equal(
        chain.filter((url) => shown.has(url)).length,
        1,
        `pixelError ${pixelError}: ${chain.join('>')}`,
      )
  }
  plain.geometry.dispose()
  accelerated.geometry.dispose()
})

test('a cut with nothing resident but the roots draws the root cover', () => {
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const resident = Uint32Array.from(dagPageUrls(dag).map((url) => (url === 'root' ? 1 : 0)))
  const result = evaluateDagSelectionKernel(
    dag,
    kernelUniforms(dag, roots, wideCamera(), 0),
    ruleResidency(dag, resident),
  )
  assert.deepEqual(
    (result.drawablePageIds ?? []).map((id) => dag.pageUrlOf(id)),
    ['root'],
  )
  // The requests still report the detail the streamer has to fetch: every page of each leaf the
  // descent keeps, the coarse ones too — their floors open, nothing finer resident — for the host
  // to rank.
  assert.deepEqual((result.pageIds ?? []).map((id) => dag.pageUrlOf(id)).sort(), [
    'leaf0',
    'leaf1',
    'leaf2',
    'leaf3',
    'mid-left',
    'mid-right',
    'root',
  ])
  fixture.geometry.dispose()
})

test('a missing cluster is replaced by its nearest resident ancestor, and only its group', () => {
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  // Every cluster is resident except one leaf: its group's replacement covers the gap on its own,
  // and the other group keeps its leaves.
  const resident = Uint32Array.from(dagPageUrls(dag).map((url) => (url === 'leaf0' ? 0 : 1)))
  const result = evaluateDagSelectionKernel(
    dag,
    kernelUniforms(dag, roots, wideCamera(), 0),
    ruleResidency(dag, resident),
  )
  const drawn = (result.drawablePageIds ?? []).map((id) => dag.pageUrlOf(id)).sort()
  assert.deepEqual(drawn, ['leaf2', 'leaf3', 'mid-left'])
  fixture.geometry.dispose()
})

test('a device that refuses the cut gets no GPU selection, and the host is told why', async () => {
  const fixture = dagFixture()
  const { dag } = packed(fixture)
  const { device } = fakeDevice({
    limits: { maxBufferSize: 1 << 20 },
    refuse: () => 'throw',
  })
  const told: unknown[][] = []
  const onRefused = (...said: unknown[]) => void told.push(said)
  assert.equal(
    await createGpuDagSelection(device, dag, { roots: hostStretches(dag), onRefused }),
    undefined,
  )
  // The device's own words reach the host: an error is never swallowed.
  assert.deepEqual(told, [['camera cut creation failed: NO_MEMORY', { why: 'NO_MEMORY' }]])
  fixture.geometry.dispose()
})

test('an empty cluster set does not allocate a GPU selection', async () => {
  installGpuGlobals()
  const dag = packDagSelection([])
  assert.equal(dag.pageCount, 0)
  assert.equal(
    await createGpuDagSelection(mockDagDevice(dag).device, dag, { roots: hostStretches(dag) }),
    undefined,
  )
})

test('GPU selection readback drawn pages match the CPU oracle for the same camera', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const cam = wideCamera()
  // The render frame is set BEFORE creation: the GPU receives matrices already brought back to
  // the eye, as the engine carries them each frame.
  const uniforms = kernelUniforms(dag, roots, cam, 3.4)
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag, {
    roots: hostStretches(dag),
  })
  assert.ok(selection)
  // Every page resident, as the CPU cut takes them: the drawn list is the cut.
  selection.updateResidency(pageResidency(new Uint8Array(dag.pageCount).fill(1)))
  selection.dispatch(uniforms)
  const gpu = await selection.flush()
  assert.ok(gpu)
  const drawn = (gpu.drawablePageIds ?? []).map((id) => dag.pageUrlOf(id))
  assert.deepEqual(drawn.sort(), cpuUrls(fixture, 3.4, cam))
  assert.equal(selection.peek()?.uniforms.pixelError, 3.4)
  selection.dispose()
  fixture.geometry.dispose()
})
