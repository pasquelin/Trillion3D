// The root and mark words written between two cuts go up as the rows that hold them, each run to
// its range, never the span between the lowest and the highest: two marks far apart send two
// rows, and two rows side by side one write the frames' mock reads as both. On 5000 generated
// placements, and on a generated field of 16.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCameraFrames } from './frameRanges.ts'
import { FRAME_VEC4 } from './types.ts'
import { primitiveWordAt } from './worlds.ts'
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { placementField } from './placementTree.fixture.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'
import { createSelectionUniforms } from '../core/selection.ts'

const COUNT = 5000,
  ROW_BYTES = FRAME_VEC4 * 16

test('two words far apart go up as their two rows', () => {
  const sources = Array.from({ length: COUNT }, (_, w) => ({
    world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, w, 0, 0, 1] },
  }))
  const worlds = new Float32Array(COUNT * 16)
  sources.forEach((source, w) => worlds.set(source.world.elements, w * 16))
  const fake = fakeDevice()
  const table = createCameraFrames(
    fake.device,
    new Float32Array(COUNT * FRAME_VEC4 * 4),
    COUNT,
    (descriptor) => fake.device.createBuffer(descriptor),
    worlds,
    sources as never,
  )
  const before = fake.writes.length
  table.writeWord(3, 1, 7)
  table.writeWord(4990, 1, 9)
  table.writeWord(3, 2, 8)
  table.flushWords()
  const sent = fake.writes.slice(before).reduce((sum, write) => sum + written(write).byteLength, 0)
  assert.equal(sent, 2 * ROW_BYTES, 'their two rows, nothing between')
  // What the buffers hold once every write landed: the three words, each at its row.
  const held = new Map<GPUBuffer, Uint8Array>()
  for (const write of fake.writes) {
    const bytes = held.get(write.buffer) ?? new Uint8Array(write.buffer.size)
    bytes.set(written(write), write.offset)
    held.set(write.buffer, bytes)
  }
  const word = (w: number, slot: number) => {
    const r = table.ranges.findIndex(({ first, count }) => w >= first && w < first + count),
      bytes = held.get(table.buffers[r])!
    return new Uint32Array(bytes.buffer)[primitiveWordAt(w - table.ranges[r].first) + slot]
  }
  assert.deepEqual([word(3, 1), word(3, 2), word(4990, 1)], [7, 8, 9])
  table.flushWords()
  assert.equal(fake.writes.length, before + 2, 'nothing more to send')
})

test('two marks on rows side by side reach the cut, read off their one write', async () => {
  installGpuGlobals()
  const packed = packDagSelection(placementField(4, 6))
  const { device, rows } = mockDagDevice(packed)
  const selection = (await createGpuDagSelection(device, packed))!
  const earlier = rows().length
  selection.markWorld(4, SHADOWLESS_ROOT)
  selection.markWorld(5, SHADOWLESS_ROOT)
  selection.dispatch(createSelectionUniforms())
  const marks = rows()
    .slice(earlier)
    .map(([first, words]) => [first / (FRAME_VEC4 * 4), words[primitiveWordAt(0) + 3]])
  assert.deepEqual(marks, [
    [4, SHADOWLESS_ROOT],
    [5, SHADOWLESS_ROOT],
  ])
})
