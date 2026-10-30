import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import {
  SKY_COMPOSITE_ENTRY,
  SKY_RAYS_ENTRY,
  SKY_TRACE_ENTRY,
  skyCompositeProgram,
  skyRaysProgram,
  skyTraceProgram,
} from './skyLightTracedWgsl.ts'

test('the sky light directions program assembles', () => {
  assertProgramAssembles(skyRaysProgram(), SKY_RAYS_ENTRY, 'the sky light directions')
})

test('the sky light trace program assembles', () => {
  assertProgramAssembles(skyTraceProgram(), SKY_TRACE_ENTRY, 'the sky light trace')
})

test('the sky light composite program assembles and adds the light times the diffuse colour', () => {
  const program = skyCompositeProgram()
  assertProgramAssembles(program, SKY_COMPOSITE_ENTRY, 'the sky light composite')
  assert.match(program, /let albedo=skyAlbedo\(base,textureLoad\(flags,pixel,0\)\.r\);/)
  assert.match(program, /textureLoad\(skyLightTexture,texel,0\)\.rgb\*albedo/)
})

test('the trace visits every pixel of a cell of any side, one a frame', () => {
  const trace = skyTraceProgram()
  assert.match(trace, /let sub=params\.flags\.w%\(up\*up\);/)
  assert.match(trace, /let pixel=cell\*up\+vec2u\(sub%up,sub\/up\);/)
  const visited = (up: number) =>
    new Set(
      Array.from(
        { length: up * up },
        (_, frame) => `${(frame % (up * up)) % up},${Math.floor((frame % (up * up)) / up)}`,
      ),
    )
  for (const up of [1, 2, 3, 4]) assert.equal(visited(up).size, up * up)
})

test('the trace with the strands’ voxels reads them under names of its own in a group after the scene trace’s, and the plain trace holds none of it', () => {
  const plain = skyTraceProgram()
  assert.ok(!plain.includes('skyHairHit'))
  assert.ok(!plain.includes('@group(3)'))
  const hair = skyTraceProgram(undefined, true)
  assertProgramAssembles(hair, SKY_TRACE_ENTRY, 'the sky light trace with the strands’ voxels')
  assert.match(hair, /@group\(3\) @binding\(0\) var<uniform> skyParams:VoxelParams;/)
  for (const name of ['skyNodes', 'skyPageIndex', 'skyVoxels'])
    assert.match(
      hair,
      new RegExp(`@group\\(3\\) @binding\\(\\d\\) var<storage,read> ${name}:array<u32>;`),
    )
  // The cut's tables keep `nodes`; no read of the volume is left under the hair passes' own names.
  assert.doesNotMatch(hair, /\bparams\.(pageResolution|pageStride|maxVoxelSize)/)
  assert.doesNotMatch(hair, /(?<![A-Za-z])(pageIndex|voxels)\[/)
  assert.match(hair, /if\(!hair\)\{hitT=skyHairHit\(/)
})

test('a ray the iteration bound stopped without a hit blocks at distance 0, not at the ray’s end', () => {
  assert.match(
    skyTraceProgram(),
    /var hitT=select\(select\(-1\.0,0\.0,!stComplete\),max\(hit\.distance,0\.0\),hit\.hit\);/,
  )
})
