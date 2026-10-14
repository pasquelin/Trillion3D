// The one rule of a table grown by the CPU (`sizedBuffer.ts`): one order whatever makes the new
// buffer — made first, the held one released after —; released, the held buffer is retired, never
// destroyed while the image being encoded may still name it, and a maker that refuses leaves it
// whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { destroyRetired } from './frameRetire.ts'
import { sizedBuffer } from './sizedBuffer.ts'

const USAGE = 0x80

test('a buffer outgrown is retired, freed once the frame is submitted', () => {
  const { device, destroyed } = fakeDevice()
  const held = sizedBuffer(device, undefined, 64, USAGE, 'Trillion3D sized')
  assert.equal(sizedBuffer(device, held, 64, USAGE, 'Trillion3D sized'), held, 'held: kept')
  const grown = sizedBuffer(device, held, 65, USAGE, 'Trillion3D sized')
  assert.notEqual(grown, held)
  assert.ok(grown.size >= 128, 'grown by the one rule: twice at least')
  assert.ok(!destroyed.includes(held), 'not destroyed at the growth: the image may name it')
  destroyRetired(device)
  assert.ok(destroyed.includes(held), 'destroyed after the frame’s submit')
})

test('a maker is asked first: its refusal keeps the held buffer, its buffer replaces it', () => {
  const { device, destroyed } = fakeDevice()
  const held = sizedBuffer(device, undefined, 16, USAGE, 'Trillion3D sized')
  const refuse = () => {
    throw new Error('GPU_CUT_TABLES_PAST_SHARE')
  }
  assert.throws(() => sizedBuffer(device, held, 64, USAGE, 'Trillion3D sized', refuse), /PAST/)
  destroyRetired(device)
  assert.ok(!destroyed.includes(held), 'refused: nothing released')
  let replaced: GPUBuffer | undefined
  const grown = sizedBuffer(device, held, 64, USAGE, 'Trillion3D sized', (descriptor, old) => {
    replaced = old
    return device.createBuffer(descriptor)
  })
  assert.equal(replaced, held, 'the maker is told what its buffer replaces')
  destroyRetired(device)
  assert.ok(destroyed.includes(held) && !destroyed.includes(grown))
})
