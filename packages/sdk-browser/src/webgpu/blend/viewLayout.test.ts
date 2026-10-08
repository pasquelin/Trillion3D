// The blend view uniform is one field table (`viewLayout.ts`): the WGSL struct, its size and the
// words the writer fills are made of it. The struct is the very text the shaders compiled, and
// each field's word is where WGSL's struct rules put it — a vec2 on an even word, a vec3, a vec4
// and the matrix on a multiple of four, the uniform rounded to four words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BLEND_VIEW_SIZE, BLEND_VIEW_WGSL, VIEW } from './viewLayout.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

test('the view table yields the shipped struct and its WGSL offsets', () => {
  assert.equal(
    wgslSource(BLEND_VIEW_WGSL),
    'struct BlendView{viewProj:mat4x4f,camPos:vec4f,lightTiles:vec2f,viewFlags:u32,vertexShift:u32,feedback:u32,pixelScale:f32,viewport:vec2f,eye:vec3f,frameNoise:f32,pixelRatio:f32,mipBias:f32,exposure:f32,toneCurve:u32,}',
  )
  assert.equal(BLEND_VIEW_SIZE, 144)
  assert.deepEqual(
    [VIEW.viewProj, VIEW.camPos, VIEW.lightTiles, VIEW.viewFlags, VIEW.vertexShift, VIEW.feedback],
    [0, 16, 20, 22, 23, 24],
  )
  assert.deepEqual(
    [VIEW.pixelScale, VIEW.viewport, VIEW.eye, VIEW.frameNoise, VIEW.pixelRatio, VIEW.mipBias],
    [25, 26, 28, 31, 32, 33],
  )
  assert.deepEqual([VIEW.exposure, VIEW.toneCurve], [34, 35])
})
