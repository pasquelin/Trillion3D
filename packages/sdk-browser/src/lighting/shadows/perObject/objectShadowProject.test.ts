// The projection of the translucent object shadows: the records the passes read, the text of the programs.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OBJECT_SHADOW_PARAM_FLOATS,
  OBJECT_SHADOW_SUBJECT_FLOATS,
  objectShadowLocalShader,
  objectShadowSunShader,
} from './objectShadowProjectWgsl.ts'
import { writeParams, writeSubject } from './objectShadowProject.ts'

const subject = {
  fade: 0.75,
  projection: {
    translatedWorldToClipInner: Float64Array.from({ length: 16 }, (_, i) => i),
    preShadowTranslation: [10, 20, 30],
    resolutionX: 64,
    resolutionY: 32,
    border: 4,
    invMaxSubjectDepth: 0.5,
    fadeStart: 0.25,
    invFadeLength: 2,
  },
} as unknown as Parameters<typeof writeSubject>[2]
const slot = { atlas: 0, x: 8, y: 16 }

test('a subject record holds the clip matrix, the offset, the rectangle in the atlas and its fade', () => {
  const out = new Float32Array(OBJECT_SHADOW_SUBJECT_FLOATS)
  writeSubject(out, 0, subject, slot, [100, 0, -100], 256)
  assert.deepEqual([...out.slice(16, 19)], [110, 20, -70])
  // The rectangle's half size over the atlas, then its offset past the border.
  assert.equal(out[20], 32 / 256)
  assert.equal(out[21], 16 / 256)
  assert.equal(out[22], 12 / 256 + 32 / 256)
  assert.equal(out[23], 20 / 256 + 16 / 256)
  assert.deepEqual([...out.slice(24, 28)], [0.5, 0.75, 0.25, 2])
  // The interior runs from the border's inside to one border past the rectangle's far side: (X + 2 * border + resolution) over the atlas.
  assert.equal(out[28], 12 / 256)
  assert.equal(out[29], 20 / 256)
  assert.equal(out[30], (8 + 8 + 64) / 256)
  assert.equal(out[31], (16 + 8 + 32) / 256)
})

test('a draw uniform holds the camera axes without its position, the viewport, the depth terms and the range', () => {
  const out = new Float32Array(OBJECT_SHADOW_PARAM_FLOATS)
  const world = new Float64Array(16).fill(1)
  writeParams(
    out,
    0,
    { view: [640, 480], projection: [], world, perspective: true, near: 0.1, far: 100 },
    { first: 3, count: 2 },
    1,
    new Float64Array(16),
  )
  assert.deepEqual([...out.slice(28, 32)], [0, 0, 0, 1])
  assert.deepEqual([...out.slice(34, 36)], [640, 480])
  assert.equal(out[36], Math.fround(0.1))
  assert.deepEqual([...out.slice(40, 44)], [3, 2, 1, 1])
})

test('the programs name their entries and hold no word of the reference', () => {
  const local = objectShadowLocalShader()
  const sun = objectShadowSunShader()
  assert.match(local, /fn objectShadowFragment/)
  assert.match(local, /fn objectShadowVertex/)
  assert.match(sun, /fn objectShadowSun/)
  for (const text of [local, sun]) assert.doesNotMatch(text, /unreal|epic|`/i)
})
