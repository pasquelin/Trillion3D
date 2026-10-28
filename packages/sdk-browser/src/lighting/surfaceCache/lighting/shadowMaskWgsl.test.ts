// The shadow mask's program assembles into a module that names nothing it does not declare, at the bindings its layout
// entries describe; the masks and the traces are sized by the light tiles and the direct light reads a texel's factor as the format keeps it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { tracedShadowWords } from './layout.ts'
import { SHADOW_MASK_BINDINGS, SHADOW_MASK_ENTRIES, shadowMaskProgramOf } from './shadowMaskWgsl.ts'
import { directProgramOf } from './directWgsl.ts'
import { lightFunctionPassWgsl } from './lightFunctionPassWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

const SHADOW_MASK_PROGRAM_WGSL = shadowMaskProgramOf('grey')
const SHADOW_MASK_COLOURED_PROGRAM_WGSL = shadowMaskProgramOf('colour')
const DIRECT_WGSL = directProgramOf('grey', WORD_LIGHT_FORMAT)
const DIRECT_COLOURED_WGSL = directProgramOf('colour', WORD_LIGHT_FORMAT)

test('the program assembles in both formats: every name declared once, none reserved, the braces paired', () => {
  for (const entry of SHADOW_MASK_ENTRIES) {
    assertProgramAssembles(SHADOW_MASK_PROGRAM_WGSL, entry)
    assertProgramAssembles(SHADOW_MASK_COLOURED_PROGRAM_WGSL, entry)
  }
})

test('a texel that does not face the centre of a light that needs a mask is settled at no light before any factor or ray, in the mask and in the cache’s own light; a light that needs none is not gated', () => {
  for (const [mask, open] of [
    [SHADOW_MASK_PROGRAM_WGSL, 'ray=ShadowRay(1.0,false);'],
    [SHADOW_MASK_COLOURED_PROGRAM_WGSL, 'ray=ShadowRay(vec3f(1.0),false);'],
  ] as const) {
    const attenuation = mask.slice(mask.indexOf('fn lightAttenuation('))
    const gate = attenuation.indexOf(
      'if(!facesLightCentre(rank,light,P,texel.normal,standalone)){return ray;}',
    )
    assert.ok(
      gate > attenuation.indexOf('declaredBareIrradiance('),
      'after the light reaches the texel',
    )
    assert.ok(gate < attenuation.indexOf(open), 'before the factor is opened')
    // The mask is a shadow's, a function's (the atlas's or apart from it) or the clouds' (one of the two lights the clouds' maps
    // shade): no other light is gated, a profile among them (it is a factor of the mask, and of the direct term, never a gate).
    assert.match(
      mask,
      /return castsShadow\(light\)\|\|hasLightFunction\(light\)\|\|standalone\|\|clouded;/,
    )
    assert.doesNotMatch(
      mask.slice(mask.indexOf('fn needsShadowMask('), mask.indexOf('fn facesLightCentre(')),
      /rofile/,
    )
    assert.match(mask, /if\(!needsShadowMask\(rank,light,standalone\)\)\{return true;\}/)
  }
  const direct = DIRECT_WGSL
  const cache = direct.slice(direct.indexOf('fn cacheLight('))
  const facing = cache.indexOf(
    'if(!facesLightCentre(rank,light,position/CM_PER_M,normal,standalone))',
  )
  assert.ok(
    facing > 0 && facing < cache.indexOf('castsShadow(light)'),
    'before a ray is cast or the light kept',
  )
  const mask = SHADOW_MASK_PROGRAM_WGSL
  assert.match(
    mask,
    /return dot\(N,select\(lampReach\(light,P\)\.xyz,-light\.directionCone\.xyz,isSun\(light\)\)\)>0\.0;/,
  )
})

test('its buffers are bound where the kernel lays them: the parameters, then the tables, the light tiles’ counters, the compacted light tiles, the masks, the lights, the clouds’ block, the factors and the traces', () => {
  const B = SHADOW_MASK_BINDINGS
  assert.deepEqual(wgslBufferBindings(SHADOW_MASK_PROGRAM_WGSL), [
    { binding: 0, type: 'uniform' },
    { binding: B.tables, type: 'read-only-storage' },
    { binding: B.counts, type: 'read-only-storage' },
    { binding: B.lightTiles, type: 'read-only-storage' },
    { binding: B.masks, type: 'storage' },
    { binding: B.lights, type: 'read-only-storage' },
    // The clouds' shade is read through a uniform block.
    { binding: B.cloudBlock, type: 'uniform' },
    { binding: B.factors, type: 'read-only-storage' },
    { binding: B.traces, type: 'storage' },
  ])
  // Seven storage buffers, under the guaranteed limit of eight. The coloured format binds the same.
  assert.equal(
    wgslBufferBindings(SHADOW_MASK_PROGRAM_WGSL).filter(({ type }) => type !== 'uniform').length,
    7,
  )
  assert.deepEqual(
    wgslBufferBindings(SHADOW_MASK_COLOURED_PROGRAM_WGSL),
    wgslBufferBindings(SHADOW_MASK_PROGRAM_WGSL),
  )
})

test('the masks and the traces are sized by the light tiles: 16 words a tile (32 in the coloured format), one word a trace for each texel of each, at least a thousand', () => {
  assert.equal(tracedShadowWords(100, 'grey', false).masks, 1600)
  assert.equal(tracedShadowWords(100, 'colour', false).masks, 3200)
  assert.equal(tracedShadowWords(100, 'grey', false).traces, 1 + 64 * 100)
  assert.equal(tracedShadowWords(1, 'grey', false).traces, 1 + 1024)
})

test('the direct light reads a texel’s factor as the format keeps it and multiplies the light’s irradiance by all of it: a colour tints the texel', () => {
  for (const direct of [DIRECT_WGSL, DIRECT_COLOURED_WGSL]) {
    assert.match(direct, /let ray=shadowRayOf\(shadowByteIn\(masks\[/)
    assert.match(direct, /if\(shadowReaches\(ray\.factor\)\)\{/)
    assert.match(
      direct,
      /irradiance\+=gathered\(rank,declaredBareIrradiance\(rank,head\.texel\.position\/CM_PER_M,head\.texel\.normal,0\.0\)\)\*ray\.factor;/,
    )
  }
  assert.match(DIRECT_COLOURED_WGSL, /struct ShadowRay\{factor:vec3f,complete:bool\}/)
  assert.match(DIRECT_WGSL, /struct ShadowRay\{factor:f32,complete:bool\}/)
  // The mask multiplies the factor by the function's share of the format, then the clouds' shade, and settles it as before.
  for (const mask of [SHADOW_MASK_PROGRAM_WGSL, SHADOW_MASK_COLOURED_PROGRAM_WGSL])
    assert.match(mask, /ray\.factor\*=lightFunctionShade\(lightFunctionOf\(light,P\)\);/)
})

test('a light is multiplied by its profile once: by the mask on the traced path, by the light term on the cache’s own ray', () => {
  for (const mask of [SHADOW_MASK_PROGRAM_WGSL, SHADOW_MASK_COLOURED_PROGRAM_WGSL]) {
    const attenuation = mask.slice(mask.indexOf('fn lightAttenuation('))
    const clouds = attenuation.indexOf('ray.factor*=cloudShadowOnSurface(rank,P);')
    const profile = attenuation.indexOf('ray.factor*=lightProfileOf(light,P);')
    const casts = attenuation.indexOf('if(!castsShadow(light)){ray.complete=true;}')
    assert.ok(
      clouds > 0 && clouds < profile && profile < casts,
      'after the clouds, before the cast gate',
    )
    assert.match(
      attenuation.slice(profile - 30, profile + 120),
      /if\(!ray\.complete\)\{\s*ray\.factor\*=lightProfileOf\(light,P\);\s*ray\.complete=!isVisibleToLight\(ray\.factor\);/,
    )
  }
  // The traced entry takes the term with no profile, the mask's factor holding it; the light's own ray takes the term with it, and the
  // share a standalone light's function leaves in the scratch (`lightFunctionPassWgsl.ts`) holds none.
  const traced = DIRECT_WGSL.slice(DIRECT_WGSL.indexOf('fn directShadeTraced'))
  assert.match(traced, /declaredBareIrradiance\(rank,/)
  assert.doesNotMatch(traced, /lightProfileOf|declaredIrradiance\(/)
  const bare = DIRECT_WGSL.slice(DIRECT_WGSL.indexOf('fn declaredBareIrradiance('))
  assert.doesNotMatch(bare.slice(0, bare.indexOf('\n}')), /lightProfileOf/)
  const own = DIRECT_WGSL.slice(DIRECT_WGSL.indexOf('fn declaredIrradiance('))
  assert.match(
    own.slice(0, own.indexOf('\n}')),
    /\*lightFunctionOf\(light,P\)\*lightProfileOf\(light,P\)/,
  )
  assert.doesNotMatch(
    lightFunctionPassWgsl({ mapped: false }),
    /lightProfileOf/,
    'the scratch share holds no profile',
  )
})
