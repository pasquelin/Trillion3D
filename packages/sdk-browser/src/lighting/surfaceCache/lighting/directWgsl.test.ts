// The direct light's two entries, through the distance field and through the shadow masks, record which lights a tile is
// uniform to in one place: the same words, from the counts of the texels that saw each light and that it did not reach.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { functionsOf } from '../../../materials/texture/shaderRule.fixture.ts'
import {
  DIRECT_COLOURED_WGSL,
  DIRECT_ENTRIES,
  DIRECT_ENTRY,
  DIRECT_TRACED_ENTRY,
  DIRECT_WGSL,
} from './directWgsl.ts'

test('the program assembles with both entries, over grey masks and over the coloured atlas’s', () => {
  for (const program of [DIRECT_WGSL, DIRECT_COLOURED_WGSL])
    for (const entry of DIRECT_ENTRIES) assertProgramAssembles(program, entry)
})

test('each entry counts its texels’ sight of every light and records the uniform ones; the words are written in one place', () => {
  for (const entry of [DIRECT_ENTRY, DIRECT_TRACED_ENTRY]) {
    const text = functionsOf(DIRECT_WGSL, [entry])
    assert.ok(text.includes('countLight(k,'), `${entry} counts`)
    assert.ok(text.includes('recordUniformLights(head,lane);'), `${entry} records`)
    assert.ok(!text.includes('factors['), `${entry} writes no word itself`)
  }
  assert.equal(DIRECT_WGSL.split('factors[at0+i]=').length, 2, 'one writer of the words')
})

test('a light that wears a light function the atlas holds no slot of gets its share from the scratch, and a texel it lets through nothing is shadowed from it, in the entry that casts its own ray', () => {
  const cache = DIRECT_WGSL.slice(DIRECT_WGSL.indexOf('fn cacheLight('))
  assert.match(
    cache,
    /if\(standalone\)\{\s*seen\.irradiance\*=share;\s*if\(!isVisibleScalar\(share\)\)\{seen\.shadowed=true;return seen;\}\s*\}/,
  )
  const entry = functionsOf(DIRECT_WGSL, [DIRECT_ENTRY])
  assert.ok(entry.includes('share=scratchFactorIn(masks[scratchWordOf(tile*lp.maxLights+k,i)],i);'))
  assert.ok(entry.includes('tileLightRank(listed)'))
})

test('a light’s irradiance on a texel is multiplied by the light’s factor on its indirect lighting, in the entry that casts its own ray and in the one that reads the masks', () => {
  assert.match(
    DIRECT_WGSL,
    /fn gathered\(rank:u32,irradiance:vec3f\)->vec3f\{return irradiance\*directLights\.items\[rank\]\.contactGi\.w;\}/,
  )
  const cache = DIRECT_WGSL.slice(DIRECT_WGSL.indexOf('fn cacheLight('))
  assert.ok(
    cache.includes('CacheLight(gathered(rank,declaredIrradiance(rank,'),
    'the light of the ray’s entry',
  )
  const traced = functionsOf(DIRECT_WGSL, [DIRECT_TRACED_ENTRY])
  assert.match(
    traced,
    /irradiance\+=gathered\(rank,declaredBareIrradiance\(rank,[^;]*\)\)\*ray\.factor;/,
    'the light of the masks’ entry',
  )
})
