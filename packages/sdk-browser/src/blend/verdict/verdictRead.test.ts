// The verdict readbacks (`verdictRead.ts`): each copy is settled by the encoder it was recorded in, and a removed view's buffers go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commitSubmitted, destroyRetired, dropSubmitted } from '../../gpu/core/frameRetire.ts'
import { createVerdictRead } from './verdictRead.ts'

const encoderOf = () => ({ copyBufferToBuffer() {} }) as unknown as GPUCommandEncoder
const settled = () => new Promise((resolve) => setImmediate(resolve))

test('a copy whose encoder was dropped maps nothing, whatever another view submits', () => {
  const { device } = fakeDevice()
  const read = createVerdictRead(device)
  const main = read.of({}),
    planar = read.of({})
  const dropped = encoderOf(),
    submitted = encoderOf()
  read.copy(dropped, {} as GPUBuffer, main)
  read.copy(submitted, {} as GPUBuffer, planar)
  dropSubmitted(dropped)
  commitSubmitted(submitted)
  assert.equal(main.ring.pending(), 0, 'the dropped copy is settled')
  assert.equal(main.ring.held(), 0, 'and maps nothing: its buffer is free again')
  assert.equal(planar.ring.held(), 1, 'the submitted copy maps')
  read.destroy()
})

test('a copy maps when its own encoder is submitted', async () => {
  const { device } = fakeDevice()
  const read = createVerdictRead(device)
  const slot = read.of({})
  const encoder = encoderOf()
  read.copy(encoder, {} as GPUBuffer, slot)
  assert.equal(slot.ring.pending(), 1)
  commitSubmitted(encoder)
  assert.equal(slot.ring.pending(), 0)
  await settled()
  assert.equal(slot.ring.held(), 0)
  read.destroy()
})

test('a removed view gives its slot back; the buffers go after the commands that name them', () => {
  const { device, buffers, destroyed } = fakeDevice()
  const read = createVerdictRead(device)
  const key = {}
  const slot = read.of(key)
  read.copy(encoderOf(), {} as GPUBuffer, slot)
  assert.equal(buffers.length, 1)
  read.release(key)
  assert.equal(read.peek(key), undefined)
  assert.equal(destroyed.length, 0, 'retired, not destroyed at once')
  destroyRetired(device)
  assert.equal(destroyed.length, 1, 'destroyed after the submit')
  assert.equal(slot.ring.take(), undefined, 'the ring is destroyed')
  read.release(key)
})

test('two open encoders of one view name one buffer between them: the second copies nothing', () => {
  const { device, buffers } = fakeDevice()
  const read = createVerdictRead(device)
  const slot = read.of({})
  const copies: GPUBuffer[] = []
  const recording = () =>
    ({
      copyBufferToBuffer: (_s: GPUBuffer, _o: number, target: GPUBuffer) => copies.push(target),
    }) as unknown as GPUCommandEncoder
  const first = recording(),
    second = recording()
  read.copy(first, {} as GPUBuffer, slot)
  read.copy(second, {} as GPUBuffer, slot)
  assert.equal(copies.length, 1, 'the second encoder carries no copy')
  assert.equal(buffers.length, 1)
  commitSubmitted(second)
  assert.equal(slot.ring.pending(), 1, 'an encoder with no copy settles nothing')
  commitSubmitted(first)
  assert.equal(slot.ring.pending(), 0)
  read.copy(second, {} as GPUBuffer, slot)
  assert.equal(copies.length, 2, 'once settled, the view copies again')
  dropSubmitted(second)
  read.destroy()
})
