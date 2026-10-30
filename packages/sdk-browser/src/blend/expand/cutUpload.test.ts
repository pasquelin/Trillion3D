// The cut words alone go up where they differ from the last sent (`expandUploads`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { expandUploads } from './expand.ts'
import type { ExpandBuffers, ExpandSlots } from './expandBuffers.ts'

test('the cut words are sent when they differ from those sent, and not otherwise', () => {
  const { device } = fakeDevice()
  const writes: number[] = []
  const queue = device.queue
  queue.writeBuffer = ((_buffer: GPUBuffer, offset: number) => void writes.push(offset)) as never
  const uploads = expandUploads(device, { frame: {} } as ExpandBuffers, 1, {} as ExpandSlots)
  const words = new Uint32Array(2)
  uploads.uploadCuts(3, words)
  assert.deepEqual(writes, [], 'nothing cut, the buffer is zero: nothing sent')
  words[1] = 1 << 4
  uploads.uploadCuts(3, words)
  assert.deepEqual(writes, [12], 'sent from its word')
  uploads.uploadCuts(3, words)
  assert.equal(writes.length, 1, 'the same cut again is not sent')
  words[1] = 0
  uploads.uploadCuts(3, words)
  assert.equal(writes.length, 2, 'back to nothing cut')
})
