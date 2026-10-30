import test from 'node:test'
import assert from 'node:assert/strict'
import { CASTER_RAY, CASTERS_ENTRY, CASTERS_PARAMS, castersWgsl } from './castersWgsl.ts'
import { casterRayFlags, castersView } from './casters.ts'
import { VISUALIZE, visualizeLabel } from '../modes.ts'
import { VISUALIZE_WGSL } from '../visualizeWgsl.ts'
import { layoutProblems } from '../../../../gpu/core/wgslLayoutMatch.fixture.ts'
import {
  CASTER_HAIR_OBJECT,
  CASTERS_HAIR_ENTRY,
  CASTERS_HAIR_PARAMS,
  castersHairEntries,
  castersHairWgsl,
} from './castersHairWgsl.ts'

test('the rays cast one a pixel from the eye through the triangles and write what they met', () => {
  const code = castersWgsl()
  assert.ok(code.includes(`fn ${CASTERS_ENTRY}(`))
  assert.ok(code.includes('stTrace(StRay('))
  assert.equal(CASTERS_PARAMS.words % 4, 0)
})

test('the rays meet every triangle whole until the materials are evaluated, and the backs unless two-sided', () => {
  assert.equal(casterRayFlags(0, true), CASTER_RAY.opaque)
  assert.equal(casterRayFlags(1, true), 0)
  assert.equal(casterRayFlags(2, false), CASTER_RAY.cullBack)
  assert.equal(casterRayFlags(0, false), CASTER_RAY.opaque | CASTER_RAY.cullBack)
})

test('the overview and both caster views take the rays, no other view', () => {
  assert.ok(castersView(VISUALIZE.overview))
  assert.ok(castersView(VISUALIZE.shadowCasters))
  assert.ok(castersView(VISUALIZE.shadowCasterQuality))
  assert.ok(!castersView(VISUALIZE.shadingConfidence))
  assert.ok(!castersView(0))
})

test('the shadow caster label says whether the masks were evaluated', () => {
  assert.equal(
    visualizeLabel(VISUALIZE.shadowCasters),
    'Shadow Casters, Materials:0, FarField:0, HairVoxels:0',
  )
  assert.equal(
    visualizeLabel(VISUALIZE.shadowCasters, true),
    'Shadow Casters, Materials:1, FarField:0, HairVoxels:0',
  )
})

test('the caster views paint the rays’ hits by instance and by the distance to the drawn surface', () => {
  assert.ok(VISUALIZE_WGSL.includes('casterHits'))
  assert.ok(VISUALIZE_WGSL.includes('vsmIntToColor(hit.z+1u)'))
  assert.ok(VISUALIZE_WGSL.includes('vec3f(1.0,0.64,0.0)'))
})

test('the rays are the scene view’s, jitter off, and a miss writes the sky through the composition’s table', () => {
  const code = castersWgsl()
  assert.ok(code.includes('fn eyeRayHit('))
  assert.ok(code.includes('vec2f(view.jitter.x,-view.jitter.y)'))
  assert.ok(code.includes('else if(!stComplete)'))
  assert.ok(code.includes('visualizeTonemap(skyRadiance('))
  assert.ok(code.includes('pack4x8unorm('))
  assert.ok(VISUALIZE_WGSL.includes('unpack4x8unorm(hit.x)'))
})

test('the quality view reads the drawn surface from the scene’s opaque-only depth (the pyramid’s first layer, never the depth buffer water and translucency write), colours and normal for every pixel that is not sky', () => {
  assert.ok(VISUALIZE_WGSL.includes('var opaqueDepth:texture_2d_array<f32>'))
  assert.ok(VISUALIZE_WGSL.includes('textureLoad(opaqueDepth,coord,0,0).r'))
  assert.ok(VISUALIZE_WGSL.includes('var colours:texture_2d_array<f32>'))
  assert.ok(VISUALIZE_WGSL.includes('let sky=drawnDepth<=1.0e-8'))
  assert.ok(VISUALIZE_WGSL.includes('viewEyeDistance(position)'))
  assert.ok(VISUALIZE_WGSL.includes('vec3f(0.3,0.59,0.11)'))
  assert.ok(!VISUALIZE_WGSL.includes('NORMAL_CELLS'))
})

test('the strands’ rays march the voxels from the eye to the farthest, jittered as the strands are, and write a hit of their own', () => {
  const code = castersHairWgsl()
  assert.ok(code.includes(`fn ${CASTERS_HAIR_ENTRY}(`))
  assert.ok(code.includes('traceVoxels('))
  assert.ok(code.includes('eyeRayOrigin(id.xy,draw,display)'))
  assert.ok(code.includes('rand4dPcg32(') && code.includes('rand3dPcg16('))
  assert.ok(code.includes(`${CASTER_HAIR_OBJECT}u`))
  assert.equal(CASTERS_HAIR_PARAMS.words % 4, 0)
})

test('the view takes the strands’ hit where it is nearer than the triangles’, and the label says the strands were marched', () => {
  assert.ok(VISUALIZE_WGSL.includes('bitcast<f32>(hair.x)<bitcast<f32>(hit.x)'))
  assert.equal(
    visualizeLabel(VISUALIZE.shadowCasters, false, true),
    'Shadow Casters, Materials:0, FarField:0, HairVoxels:1',
  )
})

test('the strands’ kernel binds what its layout gives', () => {
  assert.deepEqual(layoutProblems(castersHairWgsl(), [castersHairEntries()]), [])
})
