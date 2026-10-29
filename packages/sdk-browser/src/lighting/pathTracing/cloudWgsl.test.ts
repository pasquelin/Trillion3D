// The traced clouds' programs, assembled as the device is given them: the trace, the finish and the acceleration map's build declare every name, reserve none and pair their braces; the programs where the clouds are not traced
// hold none of their code.
import test from 'node:test'
import assert from 'node:assert/strict'
import { withoutComments } from '../../../../math/src/wgsl/comments.fixture.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { dagReadLayoutEntries } from '../../geometry/dag/shader/bindings.ts'
import { sceneTraceLayoutEntries } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { cloudMaterialLayoutEntries } from '../../modules/sky/clouds/materialWgsl.ts'
import { PT_CLOUD_FINISH_TEXTURES } from './cloudFrame.ts'
import { PT_CLOUD_MAP_ENTRY, PT_CLOUD_MAP_WGSL } from './cloudMapWgsl.ts'
import { PT_CLOUD_BINDINGS, PT_CLOUD_FLAG } from './cloudMediumWgsl.ts'
import {
  PT_FINISH_ENTRY,
  PT_TRACE_ENTRIES,
  ptFinishProgram,
  ptTraceProgram,
} from './traceProgram.ts'

const sampledTextures = (text: string) =>
  new Set([...text.matchAll(/var (\w+)\s*:\s*texture_(?!storage)\w+</g)].map((match) => match[1]))
    .size

test('the trace and the finish where the clouds are traced have their entries and declare every name', () => {
  for (const entry of Object.values(PT_TRACE_ENTRIES))
    assertProgramAssembles(ptTraceProgram(true), entry, `the trace with clouds ${entry}`)
  assertProgramAssembles(ptFinishProgram(true), PT_FINISH_ENTRY, 'the finish with clouds')
  assertProgramAssembles(PT_CLOUD_MAP_WGSL, PT_CLOUD_MAP_ENTRY, 'the cloud acceleration map')
})

test('the programs where the clouds are not traced hold nothing of them', () => {
  for (const text of [ptTraceProgram(), ptFinishProgram()]) {
    assert.doesNotMatch(text, /ptCloud|ptVolumeTrack|cloudMaterial/)
    assert.match(text, /ptAirTrack\(|ptAirVisible\(/)
  }
  assert.match(
    ptFinishProgram(),
    /fn ptVisibleRgb\(path:ptr<function,PtPath>,origin:vec3f,direction:vec3f,tMax:f32,casts:bool\)->vec3f/,
  )
})

test('the trace walks the clouds in the way, and the finish lights their events with four lobes and shades a light that casts cloud shadows', () => {
  const trace = ptTraceProgram(true)
  assert.match(trace, /ptVolumeTrack\(path,ray,/)
  assert.doesNotMatch(trace, /\n {2}ptAirTrack\(path,ray,/)
  assert.match(trace, /fn ptCloudMarch\(/)
  const finish = ptFinishProgram(true)
  assert.match(
    finish,
    /struct PtAirPhase\{rayleigh:vec3f,mie:vec3f,g:f32,first:vec3f,second:vec3f,angles:vec2f,\}/,
  )
  assert.match(finish, /ptAirPhaseAt\(s\.position,\(\*path\)\.octave,\(\*path\)\.roughness\)/)
  assert.match(finish, /ptLightCastsCloudShadow\(id\)\|\|medium/)
  assert.match(finish, /if\(medium&&\(\*path\)\.octave>0u\)\{return false;\}/)
  assert.doesNotMatch(finish, /fn ptCloudMarch\(/)
})

test('the clouds add bindings at their own places, and the trace stays within the sixteen sampled textures every device grants, the finish takes the count a device is asked for, and the storage buffers stay at eight', () => {
  for (const text of [ptTraceProgram(true), ptFinishProgram(true)]) {
    assert.match(
      text,
      new RegExp(`@binding\\(${PT_CLOUD_BINDINGS.params}\\) var<uniform> ptCloud:PtCloud`),
    )
    assert.match(text, new RegExp(`@binding\\(${PT_CLOUD_BINDINGS.map}\\) var ptCloudMap`))
    assert.match(
      text,
      new RegExp(`@binding\\(${PT_CLOUD_BINDINGS.material}\\) var<uniform> cloudMaterial`),
    )
    assert.ok(new Set([...text.matchAll(/var<storage[^>]*>\s*(\w+)/g)].map((m) => m[1])).size <= 8)
  }
  assert.equal(sampledTextures(ptTraceProgram(true)), sampledTextures(ptTraceProgram()) + 6)
  assert.ok(sampledTextures(ptTraceProgram(true)) <= 16)
  // The finish binds the count the constant says: a device that grants fewer traces no clouds.
  // The device counts the layout's textures, used by the text or not: the cut's, the air's table, the grid's, the sky's, and the clouds' material and map.
  Object.assign(globalThis, { GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 } })
  const textures = (entries: readonly { texture?: unknown }[]) =>
    entries.filter((entry) => entry.texture).length
  assert.equal(
    textures(dagReadLayoutEntries()) +
      textures(sceneTraceLayoutEntries(0)) +
      textures(cloudMaterialLayoutEntries(PT_CLOUD_BINDINGS.material)) +
      1 +
      1 +
      2 +
      2,
    PT_CLOUD_FINISH_TEXTURES,
  )
})

test('the march follows the reference: voxel walk, slabs, spectral distance, reservoir events, octaves of the approximation', () => {
  const trace = ptTraceProgram(true)
  assert.match(trace, /ptAirSampleDistance\(ptRand1\(&\(\*path\)\.rand\),bar,thr\)/)
  assert.match(trace, /if\(t\+dist<stretchEnd\)\{/)
  assert.match(trace, /for\(var k=1u;k<=octaves;k\+\+\)/)
  assert.match(trace, new RegExp(`\\(ptCloud\\.options\\.y&${PT_CLOUD_FLAG.approximate}u\\)`))
  assert.match(trace, /if\(roughness>ptCloud\.march\.w\)\{return none;\}/)
})

test('the cloud code names no word of the reference and holds no backtick in its WGSL code', () => {
  for (const text of [ptTraceProgram(true), ptFinishProgram(true), PT_CLOUD_MAP_WGSL]) {
    assert.doesNotMatch(text, /Unreal|Epic|Lumen|Nanite|Substrate|MegaLights/)
    // The raster's material block, which these programs share, quotes its names in its comments.
    assert.doesNotMatch(withoutComments(text), /`/)
  }
})

test('an octave of the multiple scattering lights and ends the path whatever share of the extinction it keeps, and the clouds scatter only for a path they are marched for', () => {
  const finish = ptFinishProgram(true)
  assert.doesNotMatch(finish, /ptCloudFactor<1\.0\)\{return false;\}/)
  assert.match(finish, /if\(medium&&\(\*path\)\.octave>0u\)\{return false;\}/)
  assert.match(finish, /fn ptAirPhaseAt\(position:vec3f,octave:u32,roughness:f32\)->PtAirPhase\{/)
  assert.match(finish, /if\(roughness<=ptCloud\.march\.w\)\{\s*cloudMaterialStart/)
})
