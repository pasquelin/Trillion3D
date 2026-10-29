// The direct light reads the shadow masks and records which lights a tile is uniform to in one place: the words, from the counts of the
// texels that saw each light and that it did not reach. Its shadows are the masks', settled by the shadow passes (`shadowTraceWgsl.ts`,
// `fieldShadowWgsl.ts`): it casts no ray itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { functionsOf } from '../../../materials/texture/shaderRule.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { DIRECT_BINDINGS, DIRECT_ENTRY, directProgramOf } from './directWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

const DIRECT_WGSL = directProgramOf('grey', WORD_LIGHT_FORMAT)
const DIRECT_COLOURED_WGSL = directProgramOf('colour', WORD_LIGHT_FORMAT)

test('the program assembles with its entry, over grey masks and over the coloured atlas’s', () => {
  for (const program of [DIRECT_WGSL, DIRECT_COLOURED_WGSL])
    assertProgramAssembles(program, DIRECT_ENTRY)
})

test('the entry counts its texels’ sight of every light and records the uniform ones; the words are written in one place', () => {
  const text = functionsOf(DIRECT_WGSL, [DIRECT_ENTRY])
  assert.ok(text.includes('countLight(k,'), 'counts')
  assert.ok(text.includes('recordUniformLights(head,lane);'), 'records')
  assert.ok(!text.includes('factors['), 'writes no word itself')
  assert.equal(DIRECT_WGSL.split('factors[at0+i]=').length, 2, 'one writer of the words')
})

test('the program casts no ray and reads no light function, cloud or profile: the masks hold them', () => {
  for (const name of [
    'cacheShadowed',
    'gdfTrace',
    'lightFunctionOf',
    'cloudShadowOnSurface',
    'lightProfileOf',
  ])
    assert.ok(!DIRECT_WGSL.includes(name), name)
  assert.deepEqual(
    wgslBufferBindings(DIRECT_WGSL).map(({ binding }) => binding),
    [
      0,
      ...[
        DIRECT_BINDINGS.tables,
        DIRECT_BINDINGS.context,
        DIRECT_BINDINGS.cardTileLights,
        DIRECT_BINDINGS.lights,
        DIRECT_BINDINGS.masks,
        DIRECT_BINDINGS.factors,
        DIRECT_BINDINGS.cardTileOffsets,
      ].sort((a, b) => a - b),
    ],
  )
})

test('a light’s irradiance on a texel is multiplied by the light’s factor on its indirect lighting and by the factor the light’s mask gives the texel', () => {
  assert.match(
    DIRECT_WGSL,
    /fn gathered\(rank:u32,irradiance:vec3f\)->vec3f\{return irradiance\*directLights\.items\[rank\]\.contactGi\.w;\}/,
  )
  const entry = functionsOf(DIRECT_WGSL, [DIRECT_ENTRY])
  assert.match(
    entry,
    /irradiance\+=gathered\(rank,declaredBareIrradiance\(rank,[^;]*\)\)\*ray\.factor;/,
  )
  assert.ok(entry.includes('if(shadowReaches(ray.factor))'))
})

test('a light’s irradiance on the cards is the engine’s one term, whose lamps of a size integrate the capsule with no distance bias, as the reference does', () => {
  // The reference integrates the capsule with its distance bias zero (DeferredLightingCommon.ush:546-548).
  const text = functionsOf(DIRECT_WGSL, [DIRECT_ENTRY])
  assert.match(text, /declaredBareIrradiance\(rank,[^;]*,0\.0\)/)
  assert.ok(DIRECT_WGSL.includes('fn capsuleLamp('))
  assert.ok(DIRECT_WGSL.includes('falloff=i01*safeRcp(lineCos*0.5+0.5+bias*i01);'))
})
