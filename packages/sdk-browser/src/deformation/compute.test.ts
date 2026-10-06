import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createDeformationCompute } from './compute.ts'

test('cluster and whole-copy deformation dispatch in one pass and reuse stable bindings', async () => {
  const gpu = fakeDevice()
  const compute = await createDeformationCompute(gpu.device)
  const buffer = () => gpu.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  const buffers = Array.from({ length: 5 }, buffer)
  const whole = { table: buffer(), count: 2 }
  const calls: string[] = []
  const encoder = {
    beginComputePass() {
      calls.push('begin')
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x: number, y: number) {
          calls.push(`${x}:${y}`)
        },
        end() {
          calls.push('end')
        },
      }
    },
  } as unknown as GPUCommandEncoder
  compute.encode(encoder, buffers, 3, 1, whole)
  assert.deepEqual(calls, ['begin', '3:1', '2:1', 'end'])
  const count = gpu.bindGroups.length
  compute.encode(encoder, buffers, 3, 2, whole)
  assert.equal(gpu.bindGroups.length, count)
  whole.table = buffer()
  compute.encode(encoder, buffers, 3, 3, whole)
  assert.equal(gpu.bindGroups.length, count + 1)
  compute.dispose()
})
