// The pool sort's group stages are armed by the host with the pool's list (`poolList.ts`): a record
// of the workgroups its count takes, in rows of the device's width, written in the queue's order
// with the count — never the list's cap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDagPoolList, poolSortArming } from './poolList.ts'
import { packDagSelection } from './pack.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { DAG_ARGS } from './shader/armWgsl.ts'
import { POOL_LANES } from '../pool/sortWords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'

test('the pool sort is armed for the slots the list holds, in rows of the device width', () => {
  const gpu = fakeDevice({ limits: { maxComputeWorkgroupsPerDimension: 4 } })
  // The cut's argument buffer as it is made (`dagTables.ts`): an indirect record the host writes.
  const usage = GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  const args = gpu.device.createBuffer({ size: 120, usage })
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

test('pages that land or leave arm the sort once, at the step before the cut, for the last count', () => {
  const packed = packDagSelection(sceneRoots(scenePages(64, 4), [new Matrix4()]))
  const armed: number[] = []
  const list = createDagPoolList(
    packed,
    () => {},
    undefined,
    (count) => armed.push(count),
  )
  let listed = 0
  for (let page = 0; page < packed.pageCount; page++) if (list.note(page, true)) listed++
  assert.ok(listed > 1, `${listed} pages listed`)
  assert.deepEqual(armed, [], 'a page that lands writes no record of its own')
  list.sync()
  assert.deepEqual(armed, [listed], 'one record, for the count the list holds')
  list.sync()
  assert.deepEqual(armed, [listed], 'a list that did not move is not armed again')
})
