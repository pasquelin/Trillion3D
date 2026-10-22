// The root and mark words written between two cuts go up as the rows that hold them, each run to
// its records, never the span between the lowest and the highest: two marks far apart send two
// rows, and two rows side by side one write the frames' mock reads as both. On 5000 generated
// placements, and on a generated field of 16.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromF32Bits } from '../../../../math/src/float/bits.ts'
import { createCameraFrames } from './cameraFrames.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { textureExtent } from '../../gpu/core/textureExtent.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { mockDagDevice } from './selection/selection.fixture.ts'
import { createGpuDagSelection } from './selection/selection.ts'
import { packDagSelection } from './pack/pack.ts'
import { placementField } from './placement/placementTree.fixture.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'
import { createSelectionUniforms } from '../../gpu/core/selection.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  FRAME_TABLE,
  MARK_WORD,
  RECORD_SHIFT_WORD,
  ROOT_WORD,
} from './frameTable.ts'
import { recordWordAt } from '../../gpu/core/recordTexture.fixture.ts'
import { hostStretches } from './hostStretches.fixture.ts'

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
    new Float32Array(COUNT * FRAME_ROW_WORDS),
    COUNT,
    worlds,
    sources as never,
  )
  const rows = () => fake.textureWrites.filter((w) => w.destination.texture === table.rows.texture)
  const before = rows().length
  table.writeWord(3, ROOT_WORD, 7)
  table.writeWord(4990, ROOT_WORD, 9)
  table.writeWord(3, RECORD_SHIFT_WORD, 8)
  table.flushWords()
  const sent = rows()
    .slice(before)
    .reduce((sum, { size }) => sum + textureExtent(size)[0] * textureExtent(size)[1], 0)
  assert.equal(sent, 2 * FRAME_ROW_WORDS, 'their two rows, nothing between')
  // What the table holds once every write landed: the three words, each at its row.
  const held = (table.rows.texture as unknown as { words: Uint32Array }).words
  const word = (w: number, slot: number) =>
    held[recordWordAt(FRAME_TABLE, table.rows.texture, 'Row', w, slot)]
  assert.deepEqual(
    [word(3, ROOT_WORD), word(3, RECORD_SHIFT_WORD), word(4990, ROOT_WORD)],
    [7, 8, 9],
  )
  table.flushWords()
  assert.equal(rows().length, before + 2, 'nothing more to send')
})

test('two marks on rows side by side reach the cut, read off their one write', async () => {
  installGpuGlobals()
  const packed = packDagSelection(placementField(4, 6))
  const { device, rows } = mockDagDevice(packed)
  const selection = (await createGpuDagSelection(device, packed, { roots: hostStretches(packed) }))!
  const earlier = rows().length
  selection.markWorld(4, SHADOWLESS_ROOT)
  selection.markWorld(5, SHADOWLESS_ROOT)
  selection.dispatch(createSelectionUniforms())
  const marks = rows()
    .slice(earlier)
    .map(([first, words]) => [first / FRAME_ROW_WORDS, words[MARK_WORD]])
  assert.deepEqual(marks, [
    [4, SHADOWLESS_ROOT],
    [5, SHADOWLESS_ROOT],
  ])
})

test('a draw distance set on a running placement reaches its frame words, its mark and the cut', async () => {
  installGpuGlobals()
  const packed = packDagSelection(placementField(4, 6))
  const { device, rows } = mockDagDevice(packed)
  const selection = (await createGpuDagSelection(device, packed, { roots: hostStretches(packed) }))!
  assert.equal(selection.drawDistances, false, 'no placement names a distance yet')
  const earlier = rows().length
  selection.drawDistanceWorld(4, { min: 2, max: 9 })
  selection.drawDistanceWorld(4, { min: 2, max: 9 })
  selection.dispatch(createSelectionUniforms())
  const words = rows()
    .slice(earlier)
    .map(([first, row]) => [
      first / FRAME_ROW_WORDS,
      [row[DRAW_NEAR_WORD], row[DRAW_FAR_WORD]].map(fromF32Bits),
      row[MARK_WORD] & DRAW_DISTANCE_MARK,
    ])
  assert.deepEqual(words, [[4, [2, 9], DRAW_DISTANCE_MARK]], 'one write')
  assert.equal(selection.drawDistances, true)
  // A mark written beside it keeps the bit; the distance taken back clears it with the words.
  selection.markWorld(4, SHADOWLESS_ROOT)
  selection.drawDistanceWorld(4, undefined)
  selection.dispatch(createSelectionUniforms())
  const last = rows().at(-1)![1]
  assert.deepEqual(
    [last[DRAW_NEAR_WORD], last[DRAW_FAR_WORD], last[MARK_WORD]],
    [0, 0, SHADOWLESS_ROOT],
  )
})
