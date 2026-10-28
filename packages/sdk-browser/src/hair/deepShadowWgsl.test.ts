// The text of the deep shadow programs: the rules of the reference they follow.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEEP_SHADOW_ALLOCATE_WGSL,
  DEEP_SHADOW_MASK_WGSL,
  DEEP_SHADOW_RASTER_WGSL,
} from './deepShadowWgsl.ts'

test('a directional light is framed by an orthographic view of the box radius, a local one by a perspective view held to the widest angle', () => {
  assert.match(
    DEEP_SHADOW_ALLOCATE_WGSL,
    /min\(params\.maxHalfFov,atan\(radius\/distanceToCentre\)\)/,
  )
  assert.match(DEEP_SHADOW_ALLOCATE_WGSL, /result\.zScale=-zScale;\n  result\.zOffset=1\.0;/)
  assert.match(DEEP_SHADOW_ALLOCATE_WGSL, /result\.zScale=-minZ\/\(maxZ-minZ\)/)
})

test('the tiles are packed from the largest bin and halved until they fit the atlas', () => {
  assert.match(DEEP_SHADOW_ALLOCATE_WGSL, /maxAllowed=maxActual\/2u/)
  assert.match(
    DEEP_SHADOW_ALLOCATE_WGSL,
    /if\(offset\.y\+rowHeight<=params\.atlasResolution\)\{break;\}/,
  )
})

test('the layers add the coverage of the strands that lie within each layer behind the front depth', () => {
  assert.match(DEEP_SHADOW_RASTER_WGSL, /vec4f\(behind\)<layerDepths/)
  assert.match(DEEP_SHADOW_RASTER_WGSL, /spine\.radius\/max\(spine\.radius,pixelRadius\)/)
})

test('the mask reads the kernel the settings name and packs the count and the visibility as the voxels do', () => {
  assert.match(DEEP_SHADOW_MASK_WGSL, /light\.kernelType==3u/)
  assert.match(DEEP_SHADOW_MASK_WGSL, /packMask\(count\*light\.densityScale,1\.0\)/)
  assert.match(DEEP_SHADOW_MASK_WGSL, /light\.layerDepths\.x\*light\.depthBiasScale/)
})
