import assert from 'node:assert/strict'
import test from 'node:test'
import { CLOUD_SHADOW_DEBUG_WGSL } from '../../modules/sky/clouds/shadowDebugWgsl.ts'
import { worldFromClip } from './encodeCloudShadowDebug.ts'

test('a clip point goes to centimetres from the camera, then to metres from the scene origin', () => {
  // A map that takes clip (x, y, z) to (100 x, 200 y, 300 z) centimetres from the camera.
  const back = new Float64Array(16)
  back[0] = 100
  back[5] = 200
  back[10] = 300
  back[15] = 1
  const m = worldFromClip(back, [10, 20, 30])
  const at = (x: number, y: number, z: number) =>
    [0, 1, 2].map((r) => m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!)
  assert.deepEqual(at(1, 1, 1), [11, 22, 33])
  assert.deepEqual(at(0, 0, 0), [10, 20, 30])
})

test('a texel with no cloud draws nothing; one with cloud draws the four edges of its quad from the near plane, moved along the rays by the depth', () => {
  assert.match(CLOUD_SHADOW_DEBUG_WGSL, /if\(data\.y<=0\.0\)\{return;\}/)
  assert.match(
    CLOUD_SHADOW_DEBUG_WGSL,
    /vec4f\(texel\/size\*vec2f\(2\.0,-2\.0\)\+vec2f\(-1\.0,1\.0\),1\.0,1\.0\)/,
  )
  assert.match(CLOUD_SHADOW_DEBUG_WGSL, /quad\.ray\.xyz\*front/)
  for (const edge of ['a,b', 'b,c', 'c,d', 'd,a'])
    assert.ok(CLOUD_SHADOW_DEBUG_WGSL.includes(`gpuLineWorld(${edge},color);`))
})
