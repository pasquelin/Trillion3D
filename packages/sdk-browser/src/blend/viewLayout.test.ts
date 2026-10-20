// The blend view uniform is one field table (`viewLayout.ts`): the WGSL struct, its size and the
// words the writer fills are made of it. The struct is the very text the shaders compiled, and
// each field's word is where WGSL's struct rules put it — a vec2 on an even word, a vec3, a vec4
// and the matrix on a multiple of four, the uniform rounded to four words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BLEND_VIEW_SIZE, BLEND_VIEW_WGSL, VIEW } from './viewLayout.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

test('the view table yields the shipped struct and its WGSL offsets', () => {
  assert.equal(
    wgslSource(BLEND_VIEW_WGSL),
    'struct BlendView{viewProj:mat4x4f,camPos:vec4f,viewRight:vec4f,viewUp:vec4f,clipW:vec4f,lightTiles:vec2f,viewFlags:u32,vertexShift:u32,feedback:u32,viewport:vec2f,eye:vec3f,pixelRatio:f32,mipBias:f32,exposure:f32,toneCurve:u32,pixelError:f32,}',
  )
  assert.equal(BLEND_VIEW_SIZE, 192)
  assert.deepEqual(
    [VIEW.viewProj, VIEW.camPos, VIEW.viewRight, VIEW.viewUp, VIEW.clipW],
    [0, 16, 20, 24, 28],
  )
  assert.deepEqual(
    [VIEW.lightTiles, VIEW.viewFlags, VIEW.vertexShift, VIEW.feedback],
    [32, 34, 35, 36],
  )
  assert.deepEqual([VIEW.viewport, VIEW.eye, VIEW.pixelRatio, VIEW.mipBias], [38, 40, 43, 44])
  assert.deepEqual([VIEW.exposure, VIEW.toneCurve], [45, 46])
})
