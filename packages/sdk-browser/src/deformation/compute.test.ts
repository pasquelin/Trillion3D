import { ComputeRun } from '../gpu/core/lazyComputePass.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createDeformationCompute } from './compute.ts'

test('float-pool and cluster deformation are passes of their own and reuse stable bindings', async () => {
  const gpu = fakeDevice()
  const compute = await createDeformationCompute(gpu.device)
  const buffer = () =>
    gpu.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    })
  // Binding 2 is the normal atlas: a view of an unfilterable 2D array, as the layout declares it.
  const normals = gpu.device
    .createTexture({ size: [1, 1, 1], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING })
    .createView({ dimension: '2d-array' })
  const buffers = Array.from({ length: 6 }, (_, at) => (at === 2 ? normals : buffer()))
  const pooled = { table: buffer(), count: 2 }
  const encoder = gpu.device.createCommandEncoder()
  // The float-pool blocks: a group each, then the pass's end; the listed clusters: one indirect
  // dispatch of the dispatch the decode's plan wrote, then the pass's end.
  compute.encode(encoder, buffers, 1, pooled)
  const steps = new ComputeRun().begin(encoder)
  compute.encodeClusters(steps, buffers, 1)
  steps.end()
  assert.equal(gpu.computePasses.length, 2)
  const names = (pass: (typeof gpu.computePasses)[number]) =>
    pass.commands.flatMap(([name, [x, y]]) =>
      name === 'dispatchWorkgroups'
        ? [`${x}:${y}`]
        : name === 'dispatchWorkgroupsIndirect'
          ? ['indirect']
          : name === 'end'
            ? ['end']
            : [],
    )
  assert.deepEqual(names(gpu.computePasses[0]), ['2:1', 'end'])
  assert.deepEqual(names(gpu.computePasses[1]), ['indirect', 'end'])
  const count = gpu.bindGroups.length
  compute.encode(encoder, buffers, 2, pooled)
  compute.encodeClusters(steps.begin(encoder), buffers, 2)
  steps.end()
  assert.equal(gpu.bindGroups.length, count)
  pooled.table = buffer()
  compute.encode(encoder, buffers, 3, pooled)
  assert.equal(gpu.bindGroups.length, count + 1)
  compute.dispose()
})
