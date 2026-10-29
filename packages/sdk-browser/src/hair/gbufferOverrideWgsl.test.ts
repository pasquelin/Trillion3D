// The strands written into the surfaces after they are laid on the image: what each way writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PIXEL_MODEL } from '../materials/surface/pixelModel.ts'
import {
  HAIR_DEPTH_OVERRIDE_WGSL,
  HAIR_GBUFFER_WRITE,
  hairGbufferOverrideWgsl,
} from './gbufferOverrideWgsl.ts'

test('the placeholder writes the tangent (0, 0, 1) as the normal with no roughness, and no colour', () => {
  const code = hairGbufferOverrideWgsl(HAIR_GBUFFER_WRITE.placeholder)
  assert.match(code, /let placeholder=true;/)
  assert.doesNotMatch(code, /colour\*inverse/)
})

test('the normal write takes the mean tangent and the mean roughness, the full write the mean colour too', () => {
  const normal = hairGbufferOverrideWgsl(HAIR_GBUFFER_WRITE.normal)
  assert.match(normal, /let placeholder=false;/)
  assert.match(normal, /normalize\(tangent\)/)
  assert.doesNotMatch(normal, /colour\*inverse/)
  const full = hairGbufferOverrideWgsl(HAIR_GBUFFER_WRITE.full)
  assert.match(full, /vec4f\(colour\*inverse,0\.0\)/)
  assert.match(full, /image\.emission!=0u/)
})

test('every way marks the pixel as one of the hair shading model that reads the light', () => {
  const flags = 2 | (PIXEL_MODEL.hair << 25)
  for (const write of [1, 2, 3])
    assert.match(hairGbufferOverrideWgsl(write), new RegExp(`vec4u\\(${flags}u`))
})

test('the depth of the nearest strand is written wherever a strand is drawn', () => {
  assert.match(HAIR_DEPTH_OVERRIDE_WGSL, /if\(!\(depth>0\.0\)\)\{discard;\}\n return depth;/)
})
