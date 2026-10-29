// The strands' custom depth, read from the shipped text: only a pixel the strands cover to the rule, whose first sample renders custom depth, writes its depth.
import test from 'node:test'
import assert from 'node:assert/strict'
import { unresolvedNames } from '../gpu/core/wgslNames.fixture.ts'
import { HAIR_CUSTOM_DEPTH_WGSL } from './customDepthWgsl.ts'
import { HAIR_FLAG } from './materialMath.ts'
import { hairFlagsOf } from './visibilityBlocks.ts'

test('a pixel writes the depth of its first sample only where the coverage and the sample flag allow', () => {
  assert.match(
    HAIR_CUSTOM_DEPTH_WGSL,
    /textureLoad\(coverage,pixel,0\)\.r<rule\.coverage\)\{discard;\}/,
  )
  assert.match(
    HAIR_CUSTOM_DEPTH_WGSL,
    new RegExp(`&${HAIR_FLAG.renderCustomDepth}u\\)==0u\\)\\{discard;\\}`),
  )
  assert.match(HAIR_CUSTOM_DEPTH_WGSL, /return bitcast<f32>\(nodeData\[at\]\);/)
})

test('the program names everything it uses', () => {
  assert.deepEqual(unresolvedNames(HAIR_CUSTOM_DEPTH_WGSL), [])
})

test('the strands render custom depth through one flag bit, none of the others', () => {
  assert.equal(hairFlagsOf(false, false, false, true), HAIR_FLAG.renderCustomDepth)
  assert.equal(hairFlagsOf(false, false, true, false), HAIR_FLAG.castContactShadow)
})
