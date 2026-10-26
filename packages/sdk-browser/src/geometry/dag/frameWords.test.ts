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
import { dagRootCounts } from './pack/packCapacity.ts'
import { NODE_KIND, NODE_PARENT, PARENT_ERROR, PARENT_SPHERE } from './nodeLayout.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { placementField } from './placement/placementTree.fixture.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/castingMark.ts'
import { createSelectionUniforms } from '../../gpu/core/selection.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_INSTANCE_MARK,
  DRAW_MARKS,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  FRAME_TABLE,
  MARK_WORD,
  RECORD_SHIFT_WORD,
  PARENT_WORD,
  ROOT_PARENT_MARK,
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
  selection.drawDistanceWorld(4, { min: 2, max: 9, perInstance: false })
  selection.drawDistanceWorld(4, { min: 2, max: 9, perInstance: false })
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

test('an instance and an object of its own set on running placements carry their own bits, a nearest alone naming a distance for the second', async () => {
  installGpuGlobals()
  const packed = packDagSelection(placementField(4, 6))
  const { device, rows } = mockDagDevice(packed)
  const selection = (await createGpuDagSelection(device, packed, { roots: hostStretches(packed) }))!
  selection.drawDistanceWorld(2, { min: 0, max: 30, perInstance: true })
  selection.drawDistanceWorld(3, { min: 8, max: 0, perInstance: false })
  selection.markWorld(2, SHADOWLESS_ROOT)
  selection.dispatch(createSelectionUniforms())
  const written = new Map<number, number[]>()
  for (const [first, row] of rows()) written.set(first / FRAME_ROW_WORDS, [...row])
  const bits = (w: number) => written.get(w)![MARK_WORD] & DRAW_MARKS
  assert.equal(bits(2), DRAW_DISTANCE_MARK | DRAW_INSTANCE_MARK, 'an instance')
  assert.equal(bits(3), DRAW_DISTANCE_MARK, 'an object of its own, its nearest alone')
  assert.equal(written.get(2)![MARK_WORD] & SHADOWLESS_ROOT, SHADOWLESS_ROOT, 'a mark beside it')
  assert.deepEqual(
    [written.get(3)![DRAW_NEAR_WORD], written.get(3)![DRAW_FAR_WORD]].map(fromF32Bits),
    [8, 0],
  )
  // One kind taken for the other: the bits follow.
  selection.drawDistanceWorld(2, { min: 0, max: 30, perInstance: false })
  selection.dispatch(createSelectionUniforms())
  for (const [first, row] of rows()) written.set(first / FRAME_ROW_WORDS, [...row])
  assert.equal(bits(2), DRAW_DISTANCE_MARK, 'no longer an instance')
})

test('the group above the root of an instance set on a running placement reaches its node, its frame word and its mark', async () => {
  installGpuGlobals()
  // A packing with room, which a node of a new group is written in.
  const roots = placementField(4, 6),
    packed = packDagSelection(roots, { ...dagRootCounts(roots), ahead: true })
  const { device, rows, nodes } = mockDagDevice(packed)
  const selection = (await createGpuDagSelection(device, packed, { roots: hostStretches(packed) }))!
  const earlier = rows().length,
    first = packed.live!.nodes
  const parent = { error: 6.5, sphere: [1.25, -2, 3, 40] as const }
  assert.equal(selection.rootParentWorld(4, parent), true)
  assert.equal(selection.rootParentWorld(4, parent), true)
  assert.equal(selection.rootParentWorld(5, parent), true, 'the same group: the same node')
  selection.dispatch(createSelectionUniforms())
  const words = rows()
    .slice(earlier)
    .map(([at, row]) => [at / FRAME_ROW_WORDS, row[PARENT_WORD], row[MARK_WORD] & ROOT_PARENT_MARK])
  assert.deepEqual(
    words,
    [
      [4, first, ROOT_PARENT_MARK],
      [5, first, ROOT_PARENT_MARK],
    ],
    'one write each',
  )
  // One node, sent once, holding the error and the ball.
  const sent = nodes().filter(([node]) => node === first)
  assert.equal(sent.length, 1)
  const held = sent[0][1]
  assert.equal(fromF32Bits(held[PARENT_ERROR]), 6.5)
  assert.deepEqual(
    Array.from({ length: 4 }, (_, k) => fromF32Bits(held[PARENT_SPHERE + k])),
    [1.25, -2, 3, 40],
  )
  assert.equal(held[NODE_KIND], NODE_PARENT)
  // A mark written beside it keeps the bit; the parent taken back clears it with the word.
  selection.markWorld(4, SHADOWLESS_ROOT)
  selection.rootParentWorld(4, undefined)
  selection.dispatch(createSelectionUniforms())
  const last = rows().at(-1)![1]
  assert.deepEqual([last[PARENT_WORD], last[MARK_WORD]], [NO_INDEX, SHADOWLESS_ROOT])
})

test('a group no node of the table has room for is told, and its placement names none', async () => {
  installGpuGlobals()
  // A packing with no room: its table holds the nodes of its primitive and no more.
  const packed = packDagSelection(placementField(4, 6))
  const { device, rows } = mockDagDevice(packed)
  const selection = (await createGpuDagSelection(device, packed, { roots: hostStretches(packed) }))!
  const earlier = rows().length
  assert.equal(selection.rootParentWorld(4, { error: 6.5, sphere: [1, 2, 3, 4] }), false)
  selection.dispatch(createSelectionUniforms())
  assert.equal(packed.mark[4] & ROOT_PARENT_MARK, 0, 'it opens whatever the group says')
  assert.equal(rows().slice(earlier).length, 0, 'nothing written for it')
  assert.equal(selection.rootParentWorld(4, undefined), true)
})
