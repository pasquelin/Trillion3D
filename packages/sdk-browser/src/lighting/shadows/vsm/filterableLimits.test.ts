// The prefiltered distant shadow's kernels as a pipeline holds them: each fits WebGPU's default
// stage limits (the history blend's pass at the eighth storage buffer), they are registered with the page
// management's kernels only where the set holds the feature, and the chain is encoded in the reference's
// order from the filters' indirect arguments, the merged pool cleared between its two uses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPUTE } from '../../../gpu/core/computeBindings.ts'
import { storageBufferCount, withinDefaults } from '../../../gpu/core/stageLimits.fixture.ts'
import { wgslComputeLayout } from '../../../gpu/core/wgslBindings.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { limitOf } from '../../../../../../tests/kit/fakeDevice/limitRules.ts'
import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { dispatchedEntries } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { VSM_PASS_PREFIX } from '../../../diagnostic/stage/passLabels.ts'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { vsmFilterableKernels } from './filterableWgsl.ts'
import { vsmPageManagementKernels } from './pageManagementWgsl.ts'
import { vsmPageManagementPipes } from './pageManagementPass.ts'
import { encodeVsmAfterRaster } from './pageManagementEncode.ts'
import { vsmPhysicalPageKernels } from './physicalPagesWgsl.ts'
import { createVsmResources, vsmBindGroupLayoutEntries } from './resources.ts'
import {
  VSM_FILTER_ARGS_BORDER,
  VSM_FILTER_ARGS_MERGE,
  VSM_FILTER_ARGS_SEPARABLE,
  VSM_FILTER_ARGS_SET_WORDS,
} from './prefilteredConstants.ts'

import { MAPS, OFF, ON } from './prefiltered.fixture.ts'

/** The storage buffers a kernel's group 0 binds, by the entries its pipeline is made of. */
const storageBuffers = (specs: Parameters<typeof vsmBindGroupLayoutEntries>[0]) =>
  storageBufferCount({
    bindGroupLayouts: [{ entries: vsmBindGroupLayoutEntries(specs, COMPUTE) }] as never,
  })

test('each kernel binds at most the eight storage buffers a stage holds: the Y pass with its history is the eighth', () => {
  const kernels = vsmFilterableKernels(ON)
  const counts: Record<string, number | undefined> = Object.fromEntries(
    Object.entries(kernels).map(([name, kernel]) => [name, storageBuffers(kernel.specs)]),
  )
  assert.deepEqual(counts, {
    propagateFilterable: 3,
    filterableX: 6,
    filterableY: 8,
    filterableBorder: 5,
    filterableMergeDown: 6,
    filterableBorderMerged: 5,
  })
  for (const [name, kernel] of Object.entries(kernels)) {
    assert.ok(
      counts[name as keyof typeof counts] <= limitOf('maxStorageBuffersPerShaderStage'),
      name,
    )
    // The module declares no binding the layout lacks: the text's own count is the same.
    withinDefaults([wgslComputeLayout(kernel.code)], name)
  }
})

test('the filters are registered with the page management’s kernels only in a set that holds the feature', () => {
  const { device } = fakeDevice()
  const names = (layout: typeof ON) => Object.keys(vsmPageManagementPipes(device, layout, false))
  const others = (layout: typeof ON) =>
    Object.keys({
      ...vsmPhysicalPageKernels(layout, { stats: false }),
      ...vsmPageManagementKernels(layout),
    })
  assert.deepEqual(names(OFF), others(OFF), 'off: the kernels it always had')
  assert.ok(!names(OFF).some((name) => name.startsWith('filterable')))
  assert.deepEqual(names(ON), [...others(ON), ...Object.keys(vsmFilterableKernels(ON))])
  assert.ok(Object.keys(vsmFilterableKernels(ON)).includes('propagateFilterable'))
})

test('the chain: X, Y, the border, the merge down, the merged border, each by its arguments', async () => {
  const fake = fakeDevice({
    limits: { maxStorageBuffersPerShaderStage: 10, maxStorageBufferBindingSize: 1 << 27 },
  })
  const res = createVsmResources(fake.device, { ...MAPS, prefilteredDistant: true })
  res.filterable!.active = true
  const options = { stats: false, lruAllocation: false, fullClears: false }
  const frame = {
    ...{ device: fake.device, mapCount: 3 },
    options: { ...options, skipDynamicInvalidation: false },
  }
  const encode = () => {
    const steps = new ComputeRun().begin(fake.device.createCommandEncoder())
    encodeVsmAfterRaster(steps, res, frame)
    steps.end()
  }
  // The first frame asks the pipelines, which compile before the next.
  encode()
  await pipelinesSettled(fake.device)
  encode()
  // The kit’s untimed encoder runs the steps in one pass, ended for the clear and begun again.
  assert.deepEqual(fake.commands.slice(-3), [
    `compute ${VSM_PASS_PREFIX}afterRaster`,
    'clear',
    `compute ${VSM_PASS_PREFIX}filterable`,
  ])
  assert.equal(fake.clears.at(-1)?.buffer, res.filterable!.merged)
  const chain = fake.dispatches.slice(-5)
  assert.deepEqual(dispatchedEntries(chain), [
    ...['vsmFilterableX', 'vsmFilterableY', 'vsmFilterableBorder'],
    ...['vsmFilterableMergeDown', 'vsmFilterableBorder'],
  ])
  const set = (k: number) => 4 * VSM_FILTER_ARGS_SET_WORDS * k
  assert.deepEqual(
    chain.map(({ offset }) => offset),
    [
      ...[VSM_FILTER_ARGS_SEPARABLE, VSM_FILTER_ARGS_SEPARABLE, VSM_FILTER_ARGS_BORDER],
      ...[VSM_FILTER_ARGS_MERGE, VSM_FILTER_ARGS_BORDER],
    ].map(set),
  )
  assert.ok(chain.every(({ buffer }) => buffer === res.filterable!.args))
})
