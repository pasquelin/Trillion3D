// The one growth transaction: what a commit replaces is retired, destroyed after the frame's submit
// — commands of the image not yet submitted may name it —, never at once and never behind a
// promise; a refused growth frees what it made at once, the table left as it was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { pendingAll, pendingBuffers } from './tableGrowth.ts'
import { destroyRetired } from './frameRetire.ts'

const storage = (device: GPUDevice, size: number) =>
  device.createBuffer({ size, usage: GPUBufferUsage.STORAGE })

test('a committed growth retires what it replaces until the frame is submitted', () => {
  const { device, destroyed, fences } = fakeDevice()
  let table = storage(device, 16)
  const replaced = table,
    next = storage(device, 32)
  const growth = pendingBuffers(device, [next], () => {
    table = next
    return [replaced]
  })
  assert.equal(growth.bytes, 32)
  growth.commit()
  assert.equal(table, next)
  assert.equal(destroyed.length, 0, 'the image encoded may still name the replaced buffer')
  assert.equal(fences(), 0, 'no wait on the queue')
  destroyRetired(device)
  assert.deepEqual(destroyed, [replaced], 'destroyed after the submit, alone')
})

test('a refused growth frees what it made at once and keeps the table', () => {
  const { device, destroyed } = fakeDevice()
  const table = storage(device, 16),
    made = [storage(device, 32), storage(device, 64)]
  const growth = pendingAll([
    pendingBuffers(device, [made[0]], () => [table]),
    undefined,
    pendingBuffers(device, [made[1]], () => []),
  ])
  assert.equal(growth.bytes, 96)
  growth.destroy()
  assert.deepEqual(destroyed, made, 'never named by a command: destroyed at once')
  destroyRetired(device)
  assert.ok(!destroyed.includes(table), 'the table it would have replaced is kept')
})
