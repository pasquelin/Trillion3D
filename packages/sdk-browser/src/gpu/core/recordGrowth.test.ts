// A record table grows in place of a second one beside it (`RecordTexture.hold`): made larger, its
// records copied once on the GPU, the texture replaced retired after the frame; a growth its maker
// refuses keeps the table it had. Over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { FakeTexture } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { createRecordTexture } from './recordTexture.ts'
import type { RecordLayout } from './recordLayout.ts'
import { recordWordAt } from './recordTexture.fixture.ts'
import { destroyRetired } from './frameRetire.ts'

/** Four records a row, four rows a layer: a growth past sixteen takes layers. */
const LAYOUT: RecordLayout = {
  label: 'records under test',
  format: 'rgba32uint',
  fields: { A: 2, B: 1 },
  rowShift: 2,
  layerShift: 2,
}

test('a table grown holds its records where they were, copied once, the old one retired', () => {
  const gpu = fakeDevice()
  const usage =
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC
  const table = createRecordTexture(gpu.device, LAYOUT, 6, usage)
  const words = Uint32Array.from({ length: 6 * 4 }, (_, k) => 100 + k)
  table.write('B', 0, 6, words.buffer, 0)
  const first = table.texture,
    view = table.view
  assert.equal(table.capacity, 8, 'its last row whole')
  assert.ok(table.hold(8), 'held without growing')
  assert.equal(table.texture, first)
  assert.ok(table.hold(40))
  assert.notEqual(table.view, view, 'a new view: the groups that bind it follow')
  assert.ok(table.capacity >= 40)
  assert.equal(gpu.textureCopies.length, 1, 'one copy, at the growth')
  const grown = table.texture as unknown as FakeTexture
  for (let r = 0; r < 6; r++) {
    const at = recordWordAt(LAYOUT, grown, 'B', r)
    assert.deepEqual([...grown.words!.subarray(at, at + 4)], [...words.subarray(r * 4, r * 4 + 4)])
  }
  assert.ok(!gpu.destroyed.includes(first as never), 'the old table lives until the frame is sent')
  destroyRetired(gpu.device)
  assert.ok(gpu.destroyed.includes(first as never), 'then goes')
})

test('a growth its maker refuses keeps the table it had', () => {
  const gpu = fakeDevice()
  let made = 0
  const table = createRecordTexture(gpu.device, LAYOUT, 4, GPUTextureUsage.COPY_SRC, (d) => {
    if (made++) throw new Error('REFUSED')
    return gpu.device.createTexture(d)
  })
  const first = table.texture
  assert.equal(table.hold(64), false)
  assert.equal(table.texture, first)
  assert.equal(table.capacity, 4)
})

test('texels copied into a table of the same layout land at their place there, a run a row', () => {
  // Four words a row, four rows a layer: the run crosses rows and a layer on both sides.
  const words: RecordLayout = {
    label: 'words under test',
    format: 'r32uint',
    fields: { Word: 1 },
    rowShift: 2,
    layerShift: 2,
  }
  const gpu = fakeDevice(),
    usage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
  const from = createRecordTexture(gpu.device, words, 32, usage),
    to = createRecordTexture(gpu.device, words, 32, usage)
  const held = Uint32Array.from({ length: 32 }, (_, k) => 100 + k)
  from.writeTexels('Word', 0, 32, held.buffer, 0)
  const encoder = gpu.device.createCommandEncoder()
  from.copyTexels(encoder, to, 'Word', 3, 9, 14)
  gpu.device.queue.submit([encoder.finish()])
  const texture = to.texture as unknown as FakeTexture
  for (let k = 0; k < 14; k++)
    assert.equal(texture.words![recordWordAt(words, texture, 'Word', 9 + k)], 103 + k, `word ${k}`)
  assert.equal(gpu.textureCopies.length, 8, 'each run within a row on both sides')
})
