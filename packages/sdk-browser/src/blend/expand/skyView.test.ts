// The sky pass's view of the expansion: a sky surface is kept out of view 0 and of the draws' views, and the one view that keeps it
// alone is the sky view, with a block of the instance list of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { blendSceneOf } from '../plan/plan.fixture.ts'
import { instanceBlocks } from './viewRoom.ts'
import {
  FACE_SKY_VIEW,
  SKY_VIEW,
  cutSkyItems,
  VIEW_COUNT,
  itemFilterWord,
  planFrameViews,
  skyViewOf,
} from './expansionViews.ts'
import type { BlendGpuItem } from '../state.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

const item = (sky: boolean) =>
  ({
    surface: surfaceOf(G.basicSurface({ transparent: true, sky })),
    geometry: { quantized: false },
    matrix: new Matrix4(),
    count: 3,
    transmissive: false,
    flags: 0,
    bounds: new Float64Array([-1, -1, -1, 1, 1, 1]),
  }) as unknown as BlendGpuItem

/** A scene of one blend and one sky surface, the words and the capacity the records and the statics would give. */
function scene() {
  const items = [item(false), item(true)]
  const blendState = blendSceneOf(items)
  blendState.instanceCapacity = 10
  blendState.drawsPacked = Uint32Array.from([
    0,
    5,
    0,
    itemFilterWord(0, false, false),
    1,
    5,
    0,
    itemFilterWord(0, false, true),
  ])
  blendState.skyItems = [items[1]]
  blendState.frameLayout.cuts = 3
  blendState.frameWords = new Uint32Array(4)
  blendState.cutWords = blendState.frameWords.subarray(3, 4)
  const rt = { blendState, gpu: {}, run: {}, context: {} } as unknown as WebgpuPagesRuntime
  return { blendState, rt }
}

test('a sky surface carries only its bit in its filter word, a layer none', () => {
  const sky = itemFilterWord(2, true, true)
  assert.equal(itemFilterWord(2, true, false) & sky, 0, 'a layer has the sky bit of none')
  assert.equal(sky & ~(1 << 5), 0, 'the sky word holds the sky bit alone')
})

test('view 0 leaves the sky surface out, the sky view keeps it alone, and it has a block of the list after the others', () => {
  const { blendState, rt } = scene()
  planFrameViews(rt)
  const [every, sky] = [blendState.frameViews[0], blendState.frameViews[SKY_VIEW]]
  assert.ok(every.exclude & (1 << 5), 'view 0 excludes the sky bit')
  assert.equal(sky.active, true)
  assert.equal(skyViewOf(blendState), SKY_VIEW)
  assert.equal(sky.require, 1 << 5)
  assert.equal(sky.exclude, 0, "it leaves out nothing by the items words: the cut is the frame's")
  assert.equal(sky.instanceBase, blendState.instanceCapacity * (instanceBlocks(blendState) - 1))
  assert.equal(FACE_SKY_VIEW, VIEW_COUNT - 1)
})

test('a scene with no sky surface opens no sky view and asks no block for it', () => {
  const { blendState, rt } = scene()
  blendState.skyItems = []
  planFrameViews(rt)
  assert.equal(skyViewOf(blendState), -1)
  assert.equal(instanceBlocks(blendState), 1)
})

const cutWord = (blendState: ReturnType<typeof scene>['blendState']) =>
  blendState.frameWords[blendState.frameLayout.cuts]

test('the cut of the view being prepared sets the bit of each sky surface it does not show, in the frame data and not in the item words', () => {
  const { blendState, rt } = scene()
  blendState.skyRanks = [1]
  const dome = blendState.skyItems[0],
    words = blendState.drawsPacked.slice()
  cutSkyItems(blendState, new Set())
  planFrameViews(rt)
  assert.equal(blendState.skyCut, 1)
  assert.equal(cutWord(blendState), 1 << 1, 'the bit of rank 1')
  assert.deepEqual(blendState.drawsPacked, words, 'the item words do not move')
  assert.equal(skyViewOf(blendState), -1, 'no sky surface left in the view')
  assert.equal(blendState.frameViews[0].active, true)
  cutSkyItems(blendState, new Set([dome]))
  planFrameViews(rt)
  assert.equal(blendState.skyCut, 0)
  assert.equal(cutWord(blendState), 0, 'a view that shows it starts the words anew')
  assert.equal(skyViewOf(blendState), SKY_VIEW)
})

test('a scene with no sky surface clears the words a scene that had some left', () => {
  const { blendState } = scene()
  blendState.skyRanks = [1]
  cutSkyItems(blendState, new Set())
  blendState.skyItems = []
  blendState.skyRanks = []
  cutSkyItems(blendState, new Set())
  assert.equal(cutWord(blendState), 0)
  assert.equal(blendState.skyCut, 0)
})

test('the cut words follow what the view draws, bit by bit', () => {
  const { blendState } = scene()
  blendState.skyRanks = [1]
  const dome = blendState.skyItems[0]
  cutSkyItems(blendState, new Set([dome]))
  assert.equal(cutWord(blendState), 0, 'nothing cut')
  cutSkyItems(blendState, new Set())
  assert.equal(cutWord(blendState), 1 << 1)
  cutSkyItems(blendState, new Set([dome]))
  assert.equal(cutWord(blendState), 0, 'back to nothing cut')
})

test('a face opens its sky view alone, with the cut of its own, closes every other view', () => {
  const { blendState, rt } = scene()
  blendState.skyRanks = [1]
  const dome = blendState.skyItems[0]
  cutSkyItems(blendState, new Set([dome]))
  planFrameViews(rt)
  cutSkyItems(blendState, new Set())
  planFrameViews(rt, true)
  assert.equal(skyViewOf(blendState, true), -1, 'the face keeps no surface')
  cutSkyItems(blendState, new Set([dome]))
  planFrameViews(rt, true)
  const face = blendState.frameViews[FACE_SKY_VIEW]
  assert.equal(skyViewOf(blendState, true), FACE_SKY_VIEW)
  assert.equal(face.exclude, 0)
  assert.equal(face.require, 1 << 5)
  assert.deepEqual(
    blendState.frameViews.map((view) => view.active),
    blendState.frameViews.map((_view, at) => at === FACE_SKY_VIEW),
  )
  assert.equal(
    skyViewOf(blendState),
    -1,
    'the sky pass view is closed: the two never stay open together',
  )
  planFrameViews(rt)
  assert.equal(skyViewOf(blendState), SKY_VIEW, 'the main image opens its own anew')
  assert.equal(skyViewOf(blendState, true), -1, 'and closes the face’s')
})

test('a cut leaves the views and the sums as they are: nothing is taken again', () => {
  const { blendState } = scene()
  blendState.skyRanks = [1]
  const epoch = blendState.viewEpoch
  cutSkyItems(blendState, new Set())
  cutSkyItems(blendState, new Set([blendState.skyItems[0]]))
  assert.equal(blendState.viewEpoch, epoch)
})
