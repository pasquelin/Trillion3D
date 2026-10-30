// The key that lets the depth pass skip its redraw (`atlasesAsDrawn`): every input that changes what the atlases hold must break it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { atlasesAsDrawn, type DrawnKey } from './objectShadowDraw.ts'

const PIPELINE = {}
const ATLAS = {}
const state = {
  drawnEpoch: 7,
  drawnScene: 3,
  drawnCasting: 2,
  castingEpoch: 2,
  drawnAtlas: ATLAS,
  drawnPipeline: PIPELINE,
  drawnWater: 5,
}
const now: DrawnKey = {
  animated: false,
  epoch: 7,
  heldDrawn: true,
  scene: 3,
  atlas: ATLAS,
  pipeline: PIPELINE,
  water: 5,
}

test('the same inputs skip the redraw', () => {
  assert.equal(atlasesAsDrawn(state, now), true)
})

test('an animated graph, a new pipeline, a moved water volume or any other input redraws', () => {
  assert.equal(atlasesAsDrawn(state, { ...now, animated: true }), false, 'a graph reading time')
  assert.equal(atlasesAsDrawn(state, { ...now, pipeline: {} }), false, 'the pipeline identity')
  assert.equal(atlasesAsDrawn(state, { ...now, water: 6 }), false, 'the water revision')
  assert.equal(atlasesAsDrawn(state, { ...now, epoch: 8 }), false, 'the hold epoch')
  assert.equal(atlasesAsDrawn(state, { ...now, heldDrawn: false }), false, 'a frame not drawn')
  assert.equal(atlasesAsDrawn(state, { ...now, scene: 4 }), false, 'the scene')
  assert.equal(atlasesAsDrawn(state, { ...now, atlas: {} }), false, 'the atlas texture')
  assert.equal(atlasesAsDrawn({ ...state, castingEpoch: 3 }, now), false, 'the casting')
})
