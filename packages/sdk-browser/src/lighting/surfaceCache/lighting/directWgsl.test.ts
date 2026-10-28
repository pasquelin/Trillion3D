// The direct light's two entries, through the distance field and through the shadow masks, record which lights a tile is
// uniform to in one place: the same words, from the counts of the texels that saw each light and that it did not reach.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { functionsOf } from '../../../materials/texture/shaderRule.fixture.ts'
import {
  directProgramOf,
  DIRECT_ENTRIES,
  DIRECT_ENTRY,
  directMeshProgramOf,
  DIRECT_TRACED_ENTRY,
  MESH_PREPASS_ENTRY,
  meshSunPrepassProgram,
} from './directWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

const DIRECT_WGSL = directProgramOf('grey', WORD_LIGHT_FORMAT)
const DIRECT_COLOURED_WGSL = directProgramOf('colour', WORD_LIGHT_FORMAT)
const DIRECT_MESH_WGSL = directMeshProgramOf('grey', WORD_LIGHT_FORMAT)
const DIRECT_MESH_COLOURED_WGSL = directMeshProgramOf('colour', WORD_LIGHT_FORMAT)

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
  assert.ok(
    entry.includes('share=scratchFactorIn(masks[scratchWordOf(tileLightMask(head,k),i)],i);'),
  )
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

test('the program that reads the meshes’ fields reads each sun’s visibility, stored by the pass before, and the other answers none', () => {
  for (const program of [DIRECT_MESH_WGSL, DIRECT_MESH_COLOURED_WGSL])
    for (const entry of DIRECT_ENTRIES) assertProgramAssembles(program, entry)
  // It traces nothing: the lists and the fields are bound by the pass before, which keeps both passes within ten storage buffers.
  assert.ok(!DIRECT_MESH_WGSL.includes('dfshTraceThroughTile'))
  assert.ok(DIRECT_MESH_WGSL.includes('return meshSunVisible[meshTexel*4u+sun];'))
  assert.ok(DIRECT_MESH_WGSL.includes('var<uniform> dfshSuns:array<DfshParams,4>;'))
  assert.ok(DIRECT_MESH_WGSL.includes('meshTexel=tile*TILE_TEXELS+at.x+at.y*LG_TILE;'))
  assert.ok(!DIRECT_WGSL.includes('dfshTraceThroughTile'))
  assert.ok(!DIRECT_WGSL.includes('meshTexel'))
  assert.ok(
    DIRECT_WGSL.includes(
      'fn meshSunVisibility(position:vec3f,normal:vec3f,toward:vec3f)->f32{return -1.0;}',
    ),
  )
  // A sun it answers for casts its shadow as a visibility, the irradiance times it; the other lights keep the global field's ray.
  const text = functionsOf(DIRECT_MESH_WGSL, ['cacheLight'])
  assert.ok(text.includes('seen.irradiance*=visibility;'))
  assert.ok(text.includes('cacheShadowed(position,normal,toward,span,!sun)'))
})

test('the pass before the direct light traces each listed sun through its lists, for the texels of the direct list', () => {
  const program = meshSunPrepassProgram()
  assertProgramAssembles(program, MESH_PREPASS_ENTRY)
  assert.ok(program.includes('dfshTraceThroughTile(sun,start,start+toward*lp.maxTrace)'))
  assert.ok(program.includes('var<uniform> dfshSuns:array<DfshParams,4>;'))
  assert.ok(program.includes('var<storage,read_write> meshSunVisible:array<f32>;'))
})

test('a light’s irradiance on the cards is the engine’s one term, whose lamps of a size integrate the capsule with no distance bias, as the reference does', () => {
  // The reference integrates the capsule with its distance bias zero (DeferredLightingCommon.ush:546-548).
  for (const entry of ['cacheLight', 'directShadeTraced'] as const) {
    const text = functionsOf(DIRECT_WGSL, [entry])
    assert.match(text, /declared(?:Bare)?Irradiance\(rank,[^;]*,0\.0\)/)
  }
  assert.ok(DIRECT_WGSL.includes('fn capsuleLamp('))
  assert.ok(DIRECT_WGSL.includes('falloff=i01*safeRcp(lineCos*0.5+0.5+bias*i01);'))
})
