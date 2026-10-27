// The radiosity's probes and their integration: the fixed jitter index holds the probes' place and their rays' cells alike,
// and the integrated light is dithered only where it blends over the images.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { RADIOSITY_INTEGRATE_ENTRY, RADIOSITY_INTEGRATE_WGSL } from './radiosityIntegrateWgsl.ts'
import { RADIOSITY_TRACE_ENTRY, RADIOSITY_TRACE_WGSL } from './radiosityTraceWgsl.ts'

test('the fixed jitter index, where one is set, holds the probes and the cells of their rays: both draw at jitterIndex', () => {
  const T = RADIOSITY_TRACE_WGSL
  assertProgramAssembles(T, RADIOSITY_TRACE_ENTRY, 'the radiosity trace')
  assert.match(
    T,
    /fn jitterIndex\(temporal:u32\)->u32\{return select\(u32\(lp\.fixedJitter\),temporal,lp\.fixedJitter<0\);\}/,
  )
  assert.match(T, /let index=jitterIndex\(temporal\)%lp\.maxFrames;/)
  assert.match(T, /blueNoiseVec2\(probeCoord,jitterIndex\(temporal\)\)/)
})

test('the integrated light is dithered in its last place only where it blends with its history', () => {
  const I = RADIOSITY_INTEGRATE_WGSL
  assertProgramAssembles(I, RADIOSITY_INTEGRATE_ENTRY, 'the radiosity integration')
  const temporal = I.slice(I.lastIndexOf('if(lgFlag(FLAG_TEMPORAL)){'))
  const blend = temporal.slice(0, temporal.indexOf('\n }') + 3)
  assert.match(
    blend,
    /radiance=ditherLight\(mix\(history,radiance,1\.0\/\(1\.0\+framesBlended\)\),/,
  )
  assert.match(
    I,
    /textureStore\(indirectAtlas,vec2i\(texel\.atlas\),vec4u\(packLight\(radiance\),0u,0u,0u\)\);/,
  )
})
