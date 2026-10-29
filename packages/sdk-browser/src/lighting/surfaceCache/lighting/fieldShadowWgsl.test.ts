// The shadow passes through the distance fields assemble into modules that name nothing they do not declare, bind the masks' own buffers beside the
// field or the suns' lists, and settle the unsettled texels of the light tiles as the reference's distance-field shadow does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import {
  FIELD_SHADOW_COLOURED_WGSL,
  FIELD_SHADOW_ENTRIES,
  FIELD_SHADOW_FIRST,
  FIELD_SHADOW_MESH_COLOURED_WGSL,
  FIELD_SHADOW_MESH_ENTRY,
  FIELD_SHADOW_MESH_WGSL,
  FIELD_SHADOW_WGSL,
} from './fieldShadowWgsl.ts'
import { MESH_SUN_STORAGE_BUFFERS } from './meshShadowWgsl.ts'
import { SHADOW_MASK_BINDINGS, SHADOW_MASK_ENTRIES } from './shadowMaskWgsl.ts'

for (const [name, text, entries] of [
  ['the global field', FIELD_SHADOW_WGSL, FIELD_SHADOW_ENTRIES],
  ['the global field over coloured masks', FIELD_SHADOW_COLOURED_WGSL, FIELD_SHADOW_ENTRIES],
  ['the suns’ meshes', FIELD_SHADOW_MESH_WGSL, [FIELD_SHADOW_MESH_ENTRY]],
  [
    'the suns’ meshes over coloured masks',
    FIELD_SHADOW_MESH_COLOURED_WGSL,
    [FIELD_SHADOW_MESH_ENTRY],
  ],
] as const)
  test(`${name}: the program assembles, every name declared once, none reserved, the braces paired`, () => {
    for (const entry of entries) assertProgramAssembles(text, entry)
  })

test('the pass through the global field has an entry for each of the masks’, over the same light tiles', () => {
  assert.deepEqual(
    FIELD_SHADOW_ENTRIES.map((entry) => entry.replace('fieldShadow', 'shadowMask')),
    [...SHADOW_MASK_ENTRIES],
  )
  assert.ok(FIELD_SHADOW_WGSL.includes('let tiles=perLightTiles();'))
  assert.match(FIELD_SHADOW_WGSL, /let tiles=slotTiles\(\d+u\);/)
})

test('the pass through the global field binds the masks’ buffers beside the field, and marches the ray the direct light used to', () => {
  const M = SHADOW_MASK_BINDINGS
  const own = wgslBufferBindings(FIELD_SHADOW_WGSL).filter(
    ({ binding }) => binding < FIELD_SHADOW_FIRST,
  )
  assert.deepEqual(own, [
    { binding: 0, type: 'uniform' },
    { binding: M.tables, type: 'read-only-storage' },
    { binding: M.counts, type: 'read-only-storage' },
    { binding: M.lightTiles, type: 'read-only-storage' },
    { binding: M.masks, type: 'storage' },
    { binding: M.lights, type: 'read-only-storage' },
  ])
  assert.ok(Object.values(M).every((binding) => binding < FIELD_SHADOW_FIRST))
  assert.match(
    FIELD_SHADOW_WGSL,
    /fn shadowRayBias\(nDotL:f32,bias:f32\)->f32\{return bias\+2\.0\*bias\*saturate\(1\.0-nDotL\);\}/,
  )
  assert.match(FIELD_SHADOW_WGSL, /if\(lamp\)\{ray\.rayEndBias=lp\.shadowBias;\}/)
  assert.match(
    FIELD_SHADOW_WGSL,
    /return select\(byte,0u,cacheShadowed\(texel\.position,texel\.normal,toward,span,!sun\)\);/,
  )
  // A sun goes as far as the trace reaches, a lamp to the lamp.
  assert.match(
    FIELD_SHADOW_WGSL,
    /let span=select\(min\(length\(offset\),lp\.maxTrace\),lp\.maxTrace,sun\);/,
  )
  assert.ok(!FIELD_SHADOW_WGSL.includes('stTrace('), 'no ray through the scene’s triangles')
  // A settled texel is left alone.
  assert.match(FIELD_SHADOW_WGSL, /if\(\(byte&SHADOW_COMPLETE\)!=0u\)\{return;\}/)
})

test('the pass through the suns’ meshes multiplies the factor by the visibility of the sun the light is, and leaves every other texel as it is', () => {
  assert.ok(
    FIELD_SHADOW_MESH_WGSL.includes('dfshTraceThroughTile(sun,start,start+toward*lp.maxTrace)'),
  )
  assert.ok(FIELD_SHADOW_MESH_WGSL.includes('var<uniform> dfshSuns:array<DfshParams,4>;'))
  assert.match(FIELD_SHADOW_MESH_WGSL, /if\(!isSun\(light\)\)\{return 0xffffffffu;\}/)
  assert.match(FIELD_SHADOW_MESH_WGSL, /ShadowRay\(shadowRayOf\(byte\)\.factor\*visibility,false\)/)
  assert.match(FIELD_SHADOW_MESH_WGSL, /if\(answered==0xffffffffu\)\{return;\}/)
  assert.ok(!FIELD_SHADOW_MESH_WGSL.includes('gdfTrace('), 'the global field is the other pass’s')
  assert.doesNotMatch(
    FIELD_SHADOW_WGSL,
    /if\(answered==0xffffffffu\)/,
    'the global pass leaves nothing',
  )
})

test('the pass through the suns’ meshes binds the masks’ five storage buffers and the lists’ one with the meshes’ four: ten, as the pass before the direct light did', () => {
  const own = wgslBufferBindings(FIELD_SHADOW_MESH_WGSL).filter(({ type }) => type !== 'uniform')
  assert.equal(own.length, 5)
  assert.equal(MESH_SUN_STORAGE_BUFFERS, own.length + 1 + 4)
  // The tiles’ lists lie in one buffer, read from the offsets the sun’s block names.
  assert.match(FIELD_SHADOW_MESH_WGSL, /var<storage,read> tileLists:array<u32>;/)
  assert.ok(!FIELD_SHADOW_MESH_WGSL.includes('tileCounts'))
})
