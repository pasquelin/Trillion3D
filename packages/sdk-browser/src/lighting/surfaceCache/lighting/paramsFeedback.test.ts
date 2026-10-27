import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHTING_FLAG, LIGHTING_PARAMS } from './layout.ts'
import { feedbackWritten, shapeOf, traceViewOf, writeLightingParams } from './params.ts'
import { lightingImage, lightingSettings as settings } from './params.fixture.ts'

test('the feedback prioritises the pages only where the setting is on (default on) and the image says the hardware path and the buffer are there', () => {
  assert.equal(settings.surfaceCacheLightingFeedback, true)
  const flagsOf = (image: boolean, setting: boolean) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(
      words,
      shapeOf(settings, 1024, false),
      { ...settings, surfaceCacheLightingFeedback: setting },
      lightingImage({ feedback: image }),
    )
    return words[LIGHTING_PARAMS.at.flags] & LIGHTING_FLAG.feedback
  }
  assert.equal(flagsOf(true, true), LIGHTING_FLAG.feedback)
  assert.equal(flagsOf(false, true), 0)
  assert.equal(flagsOf(true, false), 0)
  assert.equal(flagsOf(false, false), 0)
  // One bit of its own, among the flags.
  const bits = Object.values(LIGHTING_FLAG)
  assert.equal(new Set(bits).size, bits.length)
  assert.ok(bits.every((bit) => Number.isInteger(Math.log2(bit))))
})

test('the rays write the feedback wherever the scene has acceleration structures, whether or not the direct light is traced', () => {
  const buffer = {} as GPUBuffer
  const file = {}
  assert.equal(feedbackWritten(buffer, file), true)
  assert.equal(feedbackWritten(undefined, file), false)
  assert.equal(feedbackWritten(buffer, undefined), false)
})

test("the scene trace's view carries the culling of the placements: the radius in metres, the angle, the two switches, the camera's direction, the instances' draw distance scale", () => {
  const view = traceViewOf(
    {
      ...settings,
      rayTracingCulling: 2,
      rayTracingCullingRadius: 25000,
      rayTracingCullingAngle: 3,
      rayTracingCullingUseDistanceToBox: false,
      rayTracingCullingUseMinDrawDistance: true,
    },
    [1, 2, 3],
    [0, 0, -1],
    7,
    { scale: 0.5, culled: true },
  )
  assert.deepEqual(view.eye, [1, 2, 3])
  assert.equal(view.treeRoot, 7)
  assert.deepEqual(view.culling, {
    mode: 2,
    radius: 250,
    angle: 3,
    useDistanceToBox: false,
    useMinDrawDistance: true,
    direction: [0, 0, -1],
    viewDistanceScale: 0.5,
    instanceDrawDistance: true,
  })
  assert.equal(
    view.skipBackFaceDistance,
    settings.surfaceCacheHardwareRayTracingSkipBackFaceHitDistance / 100,
  )
})
