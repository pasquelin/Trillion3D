// The radiosity's rays: the program that marches the global field and the one that casts through the scene's triangles
// assemble, bind clear of the cut's tables, and the traced one follows the reference ray step by step.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { SELF_INTERSECTION } from './layout.ts'
import {
  RADIOSITY_TRACE_BINDINGS,
  RADIOSITY_TRACE_ENTRY,
  RADIOSITY_TRACE_UNREAD,
  RADIOSITY_TRACE_WGSL,
  RADIOSITY_TRACED_BINDINGS,
  RADIOSITY_TRACED_SCENE,
  RADIOSITY_TRACED_UNREAD,
  RADIOSITY_TRACED_WGSL,
} from './radiosityTraceWgsl.ts'

for (const [name, text] of [
  ['through the global field', RADIOSITY_TRACE_WGSL],
  ['through the scene’s triangles', RADIOSITY_TRACED_WGSL],
] as const)
  test(`the radiosity trace ${name}: the program assembles, every name declared once, none reserved, the braces paired`, () => {
    assertProgramAssembles(text, RADIOSITY_TRACE_ENTRY)
  })

test('the layers the traces read are the cards’ tables, the depth, the normal and the final light, at the library’s offsets', () => {
  for (const [bindings, unread] of [
    [RADIOSITY_TRACE_BINDINGS, RADIOSITY_TRACE_UNREAD],
    [RADIOSITY_TRACED_BINDINGS, RADIOSITY_TRACED_UNREAD],
  ] as const) {
    const first = bindings.tables
    assert.deepEqual(
      [bindings.depth, bindings.albedo, bindings.normal, bindings.emissive, bindings.final],
      [first + 1, first + 2, first + 3, first + 4, first + 7],
    )
    assert.deepEqual(unread, [first + 2, first + 4, first + 5, first + 6])
  }
  // The field’s trace keeps the bindings it always had.
  assert.deepEqual(
    [
      RADIOSITY_TRACE_BINDINGS.tables,
      RADIOSITY_TRACE_BINDINGS.final,
      RADIOSITY_TRACE_BINDINGS.noise,
    ],
    [1, 8, 24],
  )
})

test('the traced trace binds clear of the cut’s tables, which keep the culling’s bindings, and within the guaranteed buffer limits', () => {
  const T = RADIOSITY_TRACED_BINDINGS
  const cut = [DAG_BINDING.nodes, DAG_BINDING.worlds, DAG_BINDING.frames, DAG_BINDING.tree]
  const own = [
    0,
    T.tables,
    T.depth,
    T.normal,
    T.final,
    T.context,
    T.out,
    T.hits,
    T.lights,
    T.sky.cube,
    T.sky.sampler,
    T.sky.harmonics,
    T.sky.params,
    T.instances,
    T.noise,
  ]
  for (const binding of cut) assert.ok(!own.includes(binding), `binding ${binding}`)
  assert.equal(new Set(own).size, own.length, 'no binding twice')
  const buffers = wgslBufferBindings(RADIOSITY_TRACED_WGSL)
  // The tables, the context, the lights and the instances of the first group, and the scene trace’s three in the second.
  assert.equal(buffers.filter(({ type }) => type !== 'uniform').length, 4)
  assert.deepEqual([RADIOSITY_TRACED_SCENE.group, RADIOSITY_TRACED_SCENE.first], [1, 0])
  assert.match(RADIOSITY_TRACED_WGSL, /@group\(1\) @binding\(0\) var<uniform> stParams/)
})

test('the traced trace marches no field: nothing of the global distance field is declared', () => {
  assert.doesNotMatch(RADIOSITY_TRACED_WGSL, /gdf|Gdf|scGlobalHit/)
  assert.match(RADIOSITY_TRACE_WGSL, /gdfTraceRay/)
})

test('the traced ray starts off its texel along the normal alone, from the bias along the ray, ignoring the translucent', () => {
  const T = RADIOSITY_TRACED_WGSL
  assert.match(T, /let start=texel\.position\+texel\.normal\*lp\.radiosityNormalBias;/)
  assert.match(T, /var tMin=lp\.radiosityRayBias\/CM_PER_M;/)
  assert.match(T, /hit=stTrace\(StRay\(origin,dir,tMin,reach,flags\)\);/)
  assert.equal(T.match(/stTrace\(/g)?.length, 2, 'one call site beside the definition')
  assert.match(T, /var flags=ST_SKIP_TRANSLUCENT;/)
  // The shadow rule is the library's; the radiosity's ray never asks it.
  const radiance = T.slice(T.indexOf('fn rayRadiance('), T.indexOf('@compute'))
  assert.doesNotMatch(radiance, /ST_SHADOW/)
})

test('the self-intersection modes are the reference’s: 0 culls the back faces, 1 traces again, 2 passes the near hits', () => {
  assert.deepEqual(SELF_INTERSECTION, { cull: 0, retrace: 1, skip: 2 })
  const T = RADIOSITY_TRACED_WGSL
  for (const [name, value] of [
    ['RAD_AVOID_CULL', 0],
    ['RAD_AVOID_RETRACE', 1],
    ['RAD_AVOID_SKIP', 2],
  ] as const)
    assert.match(T, new RegExp(`const ${name}:u32=${value}u;`))
  assert.match(T, /if\(lp\.selfIntersections==RAD_AVOID_CULL\)\{flags\|=ST_CULL_BACK;\}/)
  // 3, the best the traversal allows, is the skip of an inline traversal.
  assert.match(T, /if\(lp\.selfIntersections>=RAD_AVOID_SKIP\)\{flags\|=ST_SKIP_NEAR;\}/)
  // The retrace: from past a two-sided hit nearer than its distance (a hair beyond it) or a back face nearer than its own (at it).
  assert.match(
    T,
    /if\(lp\.selfIntersections!=RAD_AVOID_RETRACE\|\|!hit\.hit\|\|trace==1u\)\{break;\}/,
  )
  assert.match(
    T,
    /hit\.distance<stParams\.skipTwoSidedDistance\)\{past=hit\.distance\+0\.01\/CM_PER_M;\}/,
  )
  assert.match(
    T,
    /!hit\.frontFace&&hit\.distance<stParams\.skipBackFaceDistance\)\{past=stParams\.skipBackFaceDistance;\}/,
  )
  assert.match(T, /if\(past<=0\.0\)\{break;\}\n  tMin=past;/)
})

test('the hit is read as the reference reads it: a stopped trace that met nothing is black, a whole one that met nothing reads the sky, a hit of a stopped trace is a hit with no light, a near or back-face hit brings nothing', () => {
  const T = RADIOSITY_TRACED_WGSL
  const body = T.slice(T.indexOf('fn rayRadiance'))
  assert.ok(
    body.includes('if(!hit.hit){return select(skyProbeRadiance(dir),vec3f(0.0),!stComplete);}'),
  )
  // A hit of a trace that stopped keeps its distance (set before) and brings no light: the cards are read only where the walk was whole.
  assert.ok(body.includes('if(!stComplete){return vec3f(0.0);}'))
  assert.ok(
    body.indexOf('rayHitDistance=length(') < body.indexOf('if(!stComplete){return vec3f(0.0);}') &&
      body.indexOf('if(!stComplete){return vec3f(0.0);}') < body.indexOf('scEvaluateMeshCards('),
    'the stopped hit is cut after its distance is kept and before the cards are read',
  )
  assert.equal(
    body.split('stComplete').length,
    3,
    'the walk being whole is read for a miss and for a hit',
  )
  assert.match(
    body,
    /hitCm<lp\.cardMinDistance\|\|\(!hit\.frontFace&&!hit\.twoSided\)\)\{return vec3f\(0\.0\);\}/,
  )
  // The cards of the placement met, at the hit point, with the cone’s footprint at its distance, at the depth bias, not at the finest pages.
  assert.match(
    body,
    /scEvaluateMeshCards\(cards,start\+dir\*hitCm,hit\.normal,scConeTangent\(f32\(lp\.hemisphere\)\)\*hitCm,lp\.cardDepthBias,false,vec2u\(0u\)\)/,
  )
  assert.match(body, /scPlacementMeshCards\(scHitPlacement\(hit\.object\)\)/)
})

test('both traces share the kernel: the thread, the intensity clamp and the write', () => {
  for (const text of [RADIOSITY_TRACE_WGSL, RADIOSITY_TRACED_WGSL]) {
    assert.match(
      text,
      /if\(brightest>lp\.maxRayIntensity\)\{radiance\*=lp\.maxRayIntensity\/brightest;\}/,
    )
    assert.match(
      text,
      /textureStore\(outTrace,vec2i\(place\),vec4u\(packLight\(radiance\*lp\.preExposure\),0u,0u,0u\)\)/,
    )
  }
})

test('the traced ray keeps the distance it met its surface at, from the texel, the longest trace where it met none, for the probes’ occlusion', () => {
  const T = RADIOSITY_TRACED_WGSL
  assert.match(T, /var outHits:texture_storage_2d<r32float,write>;/)
  // Every thread starts at the longest trace, a texel with no surface and a ray that hit nothing included.
  assert.match(T, /rayHitDistance=lp\.maxTrace;\n if\(texel\.valid\)\{/)
  // A hit sets it before any of the early returns after: the length from the texel to the hit's point.
  const radiance = T.slice(T.indexOf('fn rayRadiance('), T.indexOf('@compute'))
  assert.ok(
    radiance.indexOf('rayHitDistance=length(texel.position-(start+dir*hitCm));') <
      radiance.indexOf('if(hitCm<lp.cardMinDistance'),
  )
  // Stored beside the radiance only where the occlusion is on; the field’s trace has none.
  assert.match(
    T,
    /if\(lgFlag\(FLAG_PROBE_OCCLUSION\)\)\{textureStore\(outHits,vec2i\(place\),vec4f\(rayHitDistance,0\.0,0\.0,0\.0\)\);\}/,
  )
  assert.doesNotMatch(RADIOSITY_TRACE_WGSL, /rayHitDistance|outHits/)
})
