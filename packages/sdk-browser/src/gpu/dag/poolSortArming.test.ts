// The pool sort's group stages are armed by the host with the pool's list (`poolList.ts`): a record
// of the workgroups its count takes, in rows of the device's width, written in the queue's order
// with the count — never the list's cap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { poolSortArming } from './poolList.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { POOL_LANES } from '../pool/sortWords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('the pool sort is armed for the slots the list holds, in rows of the device width', () => {
  const gpu = fakeDevice({ limits: { maxComputeWorkgroupsPerDimension: 4 } })
  const args = gpu.device.createBuffer({ size: 120, usage: GPUBufferUsage.STORAGE })
  const arm = poolSortArming(gpu.device, args)
  const record = () => {
    const last = gpu.writes.at(-1)!
    assert.equal(last.offset, DAG_ARGS.pool)
    return [...new Uint32Array((last.data as Uint32Array).slice().buffer)]
  }
  arm(0)
  assert.deepEqual(record(), [0, 1], 'an empty list: no workgroup')
  arm(POOL_LANES + 1)
  assert.deepEqual(record(), [2, 1])
  arm(9 * POOL_LANES)
  assert.deepEqual(record(), [4, 3], 'nine groups in rows of four')
})
