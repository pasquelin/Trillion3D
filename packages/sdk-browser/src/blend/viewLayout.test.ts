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
      'struct BlendView{viewProj:mat4x4f,camPos:vec4f,viewRight:vec4f,viewUp:vec4f,clipW:vec4f,lightTiles:vec2f,viewFlags:u32,vertexShift:u32,feedback:u32,roughDiffuse:u32,shadingAccurate:u32,viewport:vec2f,eye:vec3f,pixelRatio:f32,mipBias:f32,exposure:f32,preExposure:f32,toneCurve:u32,pixelError:f32,time:f32,realTime:f32,clearCoatNormal:u32,clipPlane:vec4f,bake:Bake,volumeCorner:array<vec4f,2>,volumeScale:array<vec4f,2>,volumeRead:vec4f,giGrid:vec4f,giZ:vec4f,holdout:u32,volumeCamera:u32,volumeCameraFactor:f32,normalCurvature:vec3f,reduced:vec2f,}',
    ),
  )
  assert.equal(BLEND_VIEW_SIZE, 240 + BAKE_BYTES + 10 * 16)
  assert.equal(VIEW.bake, 60, 'after the clip plane, on a vec4 boundary')
  // The volume's two cascades' corners, their scales and the read words follow the baking words, each a vec4 on its own boundary.
  assert.deepEqual(
    [VIEW.volumeCorner, VIEW.volumeScale, VIEW.volumeRead],
    [60 + BAKE_BYTES / 4, 60 + BAKE_BYTES / 4 + 8, 60 + BAKE_BYTES / 4 + 16],
  )
  // The translucency global illumination volume's grid and slices' law follow, a vec4 each.
  assert.deepEqual([VIEW.giGrid, VIEW.giZ], [60 + BAKE_BYTES / 4 + 20, 60 + BAKE_BYTES / 4 + 24])
  // The alpha holdout's switch follows the read words.
  assert.equal(VIEW.holdout, 60 + BAKE_BYTES / 4 + 28)
  // The heterogeneous volumes' camera map's switch and factor take the two words the holdout leaves before the next vec4 boundary.
  assert.deepEqual(
    [VIEW.volumeCamera, VIEW.volumeCameraFactor],
    [VIEW.holdout + 1, VIEW.holdout + 2],
  )
  // The normal curvature's curve follows, a vec3f on its own 16-byte boundary.
  assert.equal(VIEW.normalCurvature, VIEW.holdout + 4)
  // The ratio of the size a pass draws at over the image's, a vec2f on an even word past the curve, the struct rounded to four words.
  assert.equal(VIEW.reduced, VIEW.normalCurvature + 4)
  assert.deepEqual(
    [VIEW.viewProj, VIEW.camPos, VIEW.viewRight, VIEW.viewUp, VIEW.clipW],
    [0, 16, 20, 24, 28],
  )
  assert.deepEqual(
    [VIEW.lightTiles, VIEW.viewFlags, VIEW.vertexShift, VIEW.feedback],
    [32, 34, 35, 36],
  )
  // The rough diffuse's switch takes the word the feedback leaves before the viewport's vec2 boundary; the exact visibility's switch
  // follows it, and the viewport's vec2 and the eye's vec3 move to the next boundaries, four words on.
  assert.equal(VIEW.roughDiffuse, 37)
  assert.equal(VIEW.shadingAccurate, 38)
  assert.deepEqual([VIEW.viewport, VIEW.eye, VIEW.pixelRatio, VIEW.mipBias], [40, 44, 47, 48])
  assert.deepEqual([VIEW.exposure, VIEW.preExposure, VIEW.toneCurve], [49, 50, 51])
  // The clocks a material graph reads — the world's time, then the wall clock's — and the clear
  // coat's switch fill the gap before the clip plane, a vec4 on its own boundary.
  assert.deepEqual(
    [VIEW.pixelError, VIEW.time, VIEW.realTime, VIEW.clearCoatNormal, VIEW.clipPlane],
    [52, 53, 54, 55, 56],
  )
})
