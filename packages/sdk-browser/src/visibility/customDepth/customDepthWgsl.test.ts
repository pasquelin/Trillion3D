// The custom depth's emission, read from the shipped text: a pixel shows a cluster or none, the stencil is the object's value under its mask.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { CUSTOM_DEPTH_EMIT_WGSL } from './customDepthWgsl.ts'
import { PLACEMENT_INFO } from '../../geometry/dag/info/placementInfoLayout.ts'

test('the program names everything it uses', () => {
  assert.deepEqual(unresolvedNames(CUSTOM_DEPTH_EMIT_WGSL), [])
})

test('a pixel of no cluster keeps the far and a zero stencil, a cluster takes the depth the view drew', () => {
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, /if\(rowAt\(at\)==NO_ROW\)\{return 0\.0;\}/)
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, /DepthStencil\(vec4u\(0u\),0\.0\)/)
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, /textureLoad\(drawn,at,0\)/)
})

test('the stencil is the value under the mask, the whole value for the default mask', () => {
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, /if\(mask==0u\)\{mask=CUSTOM_DEPTH_VALUE_MASK;\}/)
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, /return word&mask;/)
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, /placements\[placement\]\.customDepth/)
})

test('the placement record the shader reads is the layout the host writes', () => {
  assert.match(CUSTOM_DEPTH_EMIT_WGSL, new RegExp(`customDepth:u32`))
  assert.equal(PLACEMENT_INFO.at.customDepth * 4 + 4 <= PLACEMENT_INFO.words * 4, true)
})
