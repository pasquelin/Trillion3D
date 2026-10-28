// The programs of the screen-space traces assemble into one text each, with the entries the pipelines name, the group sizes the
// reference's tiles need, and no character that breaks a template (a backtick) or a string (an apostrophe in a comment is fine, in code not).
import test from 'node:test'
import assert from 'node:assert/strict'
import { screenReflectionsWgsl, screenReflectionTilesWgsl } from './reflectionsWgsl.ts'
import { temporalWgsl } from './temporalWgsl.ts'
import { diffuseWgsl } from './diffuseWgsl.ts'
import { prevFrameFirstWgsl, prevFrameLowerWgsl } from './prevFrameWgsl.ts'
import { screenGiConfig } from './screenSpaceQuality.ts'
import {
  SCREEN_SPACE_VIEW_WORDS,
  writeScreenSpaceView,
  type ScreenSpaceViewFields,
} from './screenSpaceView.ts'
import { SCREEN_SPACE_VIEW_AT } from './screenSpaceViewAt.ts'

const entries = (code: string) =>
  [...code.matchAll(/@(?:compute|vertex|fragment)[^{]*?\bfn (\w+)/g)].map((m) => m[1])

test('the reflections program has the compute, fragment, tile and stencil entries at every level, and the checker at level 0', () => {
  for (const code of [0, 1, 2, 3, 4]) {
    const text = screenReflectionsWgsl(code)
    assert.deepEqual(entries(text).sort(), [
      'fullscreenVertex',
      'reflectionCompute',
      'reflectionFragment',
      'reflectionStencil',
      'reflectionTilesFragment',
      'tileVertex',
    ])
    assert.ok(!text.includes('`'))
  }
  assert.ok(screenReflectionsWgsl(0).includes('*0.2;'))
})

test('the levels spend their steps and rays: a mirror takes the steps of all the rays, up to 24', () => {
  assert.ok(screenReflectionsWgsl(3).includes('var numSteps=8u;'))
  assert.ok(screenReflectionsWgsl(3).includes('var numRays=4u;'))
  assert.ok(screenReflectionsWgsl(3).includes('min(numSteps*numRays,24u)'))
  assert.ok(screenReflectionsWgsl(4).includes('var numRays=12u;'))
  assert.ok(!screenReflectionsWgsl(1).includes('hammersley16(i,numRays'))
  assert.ok(screenReflectionsWgsl(2).includes('var numSteps=16u;'))
})

test('the tile program marks and lists tiles of 8 by 8 into the draw and dispatch arguments', () => {
  const text = screenReflectionTilesWgsl()
  assert.deepEqual(entries(text).sort(), ['reflectionTileList', 'reflectionTileMark'])
  assert.ok(text.includes('@workgroup_size(8,8)'))
  assert.ok(text.includes('atomicStore(&tileArguments[0],6u)'))
  assert.ok(!text.includes('`'))
})

test('the diffuse program has 256 lanes at every quality', () => {
  for (const level of [1, 2, 3, 4]) {
    const { rays, tileX, tileY } = screenGiConfig(level)
    const text = diffuseWgsl(level)
    assert.ok(text.includes(`@workgroup_size(${tileX},${tileY},${rays})`))
    assert.ok(text.includes(`const LANES:u32=256u;`))
    assert.deepEqual(entries(text), ['diffuseCompute'])
    assert.ok(!text.includes('`'))
  }
})

test('the reduction passes barrier between the reads and the writes of a level', () => {
  for (const [text, entry] of [
    [prevFrameFirstWgsl(), 'reduceFirst'],
    [prevFrameLowerWgsl(), 'reduceLower'],
  ] as const) {
    assert.deepEqual(entries(text), [entry])
    assert.ok(text.includes('@workgroup_size(8,8)'))
    assert.ok(!text.includes('`'))
  }
  const reduce = prevFrameFirstWgsl()
  const loop = reduce.slice(reduce.indexOf('fn reduceGroup'))
  assert.ok((loop.match(/workgroupBarrier\(\)/g) ?? []).length >= 3)
})

test('the view is written field by field at its layout', () => {
  const words = new Float32Array(SCREEN_SPACE_VIEW_WORDS)
  const unsigned = new Uint32Array(words.buffer)
  const identity = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0))
  const fields: ScreenSpaceViewFields = {
    worldToClip: identity,
    clipToWorld: identity,
    worldToView: identity,
    viewToWorld: identity,
    clipToPrevClip: identity,
    prevClipToWorld: identity,
    depth: [1, 2, 3, 4],
    size: [200, 100],
    perspective: true,
    origin: [0, 0, 0],
    forward: [0, 0, 1],
    pixelRadius: [0.5, 0],
    projectionScale: [2, 3],
    previous: [5, 6, 7, 8],
    reduced: [1, 1, 0, 0],
    reducedLimit: [9, 8, 2, 0.5],
    frame: [3, 4, 5, 6],
    reflection: [1, -3, 0, 1],
    tiles: [10, 5, 0, 0.6],
    minSpecular: 0.25,
    preExposure: 2,
    sky: [1000, 1],
    temporal: [0.25, -0.25, 1, 0],
    blur: [1, 0, 1],
  }
  writeScreenSpaceView(words, unsigned, fields)
  const at = SCREEN_SPACE_VIEW_AT
  assert.deepEqual(
    [...words.slice(at.size, at.size + 4)],
    [200, 100, Math.fround(0.005), Math.fround(0.01)],
  )
  assert.deepEqual([...words.slice(at.camera, at.camera + 4)], [0, 0, 0, 1])
  assert.deepEqual([...words.slice(at.pixelRadius, at.pixelRadius + 4)], [0.5, 0, 2, 3])
  assert.deepEqual([...unsigned.slice(at.frame, at.frame + 4)], [3, 4, 5, 6])
  assert.deepEqual([...words.slice(at.tileSpecular, at.tileSpecular + 4)], [0.25, 0, 0, 2])
  assert.equal(words[at.worldToClip + 5], 1)
})

test('the temporal filter blends one eighth of the new image, clamps the history to the plus box and takes the centre back by the aliasing law', () => {
  const text = temporalWgsl()
  assert.deepEqual(entries(text), ['temporalCompute'])
  assert.ok(text.includes('var blend=1.0/8.0;'))
  assert.ok(text.includes('history=clamp(history,boxMin,boxMax);'))
  assert.ok(text.includes('1.0/(1.0+contrast*128.0)'))
  assert.ok(!text.includes('`'))
})
