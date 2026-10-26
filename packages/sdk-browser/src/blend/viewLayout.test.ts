// The blend view uniform is one field table (`viewLayout.ts`): the WGSL struct, its size and the
// words the writer fills are made of it. The struct is the very text the shaders compiled, and
// each field's word is where WGSL's struct rules put it — a vec2 on an even word, a vec3, a vec4
// and the matrix on a multiple of four, the uniform rounded to four words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BLEND_VIEW_SIZE, BLEND_VIEW_WGSL, VIEW } from './viewLayout.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'
import { BAKE_BYTES } from '../lighting/toneBakeWgsl.ts'

test('the view table yields the shipped struct and its WGSL offsets', () => {
  // The view ends with the translucency lighting volume's boxes and the global illumination volume's grid, after a copy of the tone table's baking words, whose
  // structure it names.
  assert.ok(
    wgslSource(BLEND_VIEW_WGSL).endsWith(
      'struct BlendView{viewProj:mat4x4f,camPos:vec4f,viewRight:vec4f,viewUp:vec4f,clipW:vec4f,lightTiles:vec2f,viewFlags:u32,vertexShift:u32,feedback:u32,viewport:vec2f,eye:vec3f,pixelRatio:f32,mipBias:f32,exposure:f32,preExposure:f32,toneCurve:u32,pixelError:f32,time:f32,realTime:f32,clearCoatNormal:u32,clipPlane:vec4f,bake:Bake,volumeCorner:array<vec4f,2>,volumeScale:array<vec4f,2>,volumeRead:vec4f,giGrid:vec4f,giZ:vec4f,holdout:u32,normalCurvature:vec3f,}',
    ),
  )
  assert.equal(BLEND_VIEW_SIZE, 224 + BAKE_BYTES + 9 * 16)
  assert.equal(VIEW.bake, 56, 'after the clip plane, on a vec4 boundary')
  // The volume's two cascades' corners, their scales and the read words follow the baking words, each a vec4 on its own boundary.
  assert.deepEqual(
    [VIEW.volumeCorner, VIEW.volumeScale, VIEW.volumeRead],
    [56 + BAKE_BYTES / 4, 56 + BAKE_BYTES / 4 + 8, 56 + BAKE_BYTES / 4 + 16],
  )
  // The translucency global illumination volume's grid and slices' law follow, a vec4 each.
  assert.deepEqual([VIEW.giGrid, VIEW.giZ], [56 + BAKE_BYTES / 4 + 20, 56 + BAKE_BYTES / 4 + 24])
  // The alpha holdout's switch follows the read words.
  assert.equal(VIEW.holdout, 56 + BAKE_BYTES / 4 + 28)
  // The normal curvature's curve follows, a vec3f on its own 16-byte boundary.
  assert.equal(VIEW.normalCurvature, VIEW.holdout + 4)
  assert.deepEqual(
    [VIEW.viewProj, VIEW.camPos, VIEW.viewRight, VIEW.viewUp, VIEW.clipW],
    [0, 16, 20, 24, 28],
  )
  assert.deepEqual(
    [VIEW.lightTiles, VIEW.viewFlags, VIEW.vertexShift, VIEW.feedback],
    [32, 34, 35, 36],
  )
  assert.deepEqual([VIEW.viewport, VIEW.eye, VIEW.pixelRatio, VIEW.mipBias], [38, 40, 43, 44])
  assert.deepEqual([VIEW.exposure, VIEW.preExposure, VIEW.toneCurve], [45, 46, 47])
  // The clocks a material graph reads — the world's time, then the wall clock's — and the clear
  // coat's switch fill the gap before the clip plane, a vec4 on its own boundary: the view stays the size
  // it was.
  assert.deepEqual(
    [VIEW.pixelError, VIEW.time, VIEW.realTime, VIEW.clearCoatNormal, VIEW.clipPlane],
    [48, 49, 50, 51, 52],
  )
})
