// The root and mark words written between two cuts go up as the rows that hold them, each run to
// its records, never the span between the lowest and the highest: two marks far apart send two
// rows, and two rows side by side one write the frames' mock reads as both. On 5000 generated
// placements, and on a generated field of 16.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCameraFrames } from './cameraFrames.ts'
import { FRAME_ROW_WORDS, FRAME_VEC4 } from './types.ts'
import { primitiveWordAt } from './worlds.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { textureExtent } from '../core/textureExtent.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { createGpuDagSelection } from './selection.ts'
import { packDagSelection } from './pack.ts'
import { placementField } from './placementTree.fixture.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { FRAME_TABLE } from './frameTable.ts'
import { fieldStart } from '../core/recordLayout.ts'

const COUNT = 5000

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
    worlds,
    sources as never,
  )
  const rows = () => fake.textureWrites.filter((w) => w.destination.texture === table.rows.texture)
  const before = rows().length
  table.writeWord(3, 1, 7)
  table.writeWord(4990, 1, 9)
  table.writeWord(3, 2, 8)
  table.flushWords()
  const sent = rows()
    .slice(before)
    .reduce((sum, { size }) => sum + textureExtent(size)[0] * textureExtent(size)[1], 0)
  assert.equal(sent, 2 * FRAME_ROW_WORDS, 'their two rows, nothing between')
  // What the table holds once every write landed: the three words, each at its row.
  const held = (table.rows.texture as unknown as { words: Uint32Array }).words
  const { rowShift } = FRAME_TABLE
  const word = (w: number, slot: number) =>
    held[
      (w >> rowShift) * fieldStart(FRAME_TABLE) +
        (w & ((1 << rowShift) - 1)) * FRAME_ROW_WORDS +
        slot
    ]
  assert.deepEqual([word(3, 1), word(3, 2), word(4990, 1)], [7, 8, 9])
  table.flushWords()
  assert.equal(rows().length, before + 2, 'nothing more to send')
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
