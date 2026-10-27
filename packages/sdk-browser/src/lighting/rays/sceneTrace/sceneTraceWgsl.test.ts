// The scene trace's WGSL text assembles into a module that names nothing it does not declare, at
// the bindings its layout entries describe, with the file's words (`rayTracingFile.ts`) and the
// cut's tables (`DAG_READ_TABLES_WGSL`) it reads; the parameters' uniform is laid as WGSL lays it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_LEAF_OFFSET_MASK,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_WIDTH,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import { dagReadLayoutEntries, DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { assertProgramAssembles, topLevelNames } from '../../../gpu/core/wgslNames.fixture.ts'
import { PROBE_FIRST, PROBE_GROUP, SCENE_TRACE_PROBE } from './sceneTraceProbe.fixture.ts'
import {
  SCENE_TRACE_PARAMS,
  sceneTraceBindEntries,
  sceneTraceLayoutEntries,
} from './sceneTraceWgsl.ts'

test('the probe assembles: every name declared once, none reserved, the braces paired', () => {
  assertProgramAssembles(SCENE_TRACE_PROBE)
})

test('it declares the trace, its ray and its hit, and the any-hit flag a shadow ray sets', () => {
  for (const name of ['StRay', 'StHit', 'stTrace', 'stBlas', 'stEnter', 'ST_ANY_HIT'])
    assert.ok(topLevelNames(SCENE_TRACE_PROBE).includes(name), name)
  assert.match(
    SCENE_TRACE_PROBE,
    /struct StRay\{origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,flags:u32,\}/,
  )
  assert.match(
    SCENE_TRACE_PROBE,
    /struct StHit\{distance:f32,placement:u32,record:u32,triangle:u32,normal:vec3f,frontFace:bool,twoSided:bool,hit:bool,\}/,
  )
  assert.match(SCENE_TRACE_PROBE, /const ST_ANY_HIT:u32=1u;/)
})

test('it reads the file as it is laid: the size of a record in words, of a triangle in vec4u', () => {
  const word = (name: string, bytes: number) =>
    assert.match(SCENE_TRACE_PROBE, new RegExp(`const ${name}:u32=${bytes / 4}u;`))
  word('ST_RECORD_WORDS', RAY_TRACING_RECORD_BYTES)
  assert.match(
    SCENE_TRACE_PROBE,
    new RegExp(`const ST_TRIANGLE_VECS:u32=${RAY_TRACING_TRIANGLE_BYTES / 16}u;`),
  )
})

test('it reads a node as five vec4u of the file: the links and metas, then the boxes’ bytes, in place', () => {
  // The corner and the exponents with the mask (words 0 to 3), the links and the metas (4 to 7),
  // the low x and y bytes (8 to 11), the low z and high x (12 to 15), the high y and z (16 to 19).
  assert.equal(RAY_TRACING_NODE_BYTES, 5 * 16)
  assert.match(SCENE_TRACE_PROBE, /stNodes:array<vec4u>/)
  assert.match(SCENE_TRACE_PROBE, /stTriangles:array<vec4u>/)
  const constant = (name: string, value: number) =>
    assert.match(SCENE_TRACE_PROBE, new RegExp(`const ${name}:u32=${value}u;`))
  constant('ST_NODE_VECS', 5)
  constant('ST_WIDTH', RAY_TRACING_WIDTH)
  constant('ST_LEAF_COUNT_SHIFT', RAY_TRACING_LEAF_COUNT_SHIFT)
  constant('ST_LEAF_OFFSET_MASK', RAY_TRACING_LEAF_OFFSET_MASK)
})

test('its bindings are those its layout entries describe, beside the cut’s tables at the culling’s', () => {
  // The probe's group beside the cut's tables: the library's bindings, then the probe's own result.
  const declared = [...SCENE_TRACE_PROBE.matchAll(/@group\((\d+)\) @binding\((\d+)\) var<(\w+)/g)]
    .map((m) => [Number(m[1]), Number(m[2]), m[3]] as const)
    .filter(([group]) => group === PROBE_GROUP)
  const entries = sceneTraceLayoutEntries(PROBE_FIRST)
  assert.equal(entries.length, 4)
  assert.deepEqual(
    declared.slice(0, entries.length).map(([, binding]) => binding),
    entries.map(({ binding }) => binding),
  )
  assert.equal(declared.length, entries.length + 1)
  assert.deepEqual(
    entries.map((entry) => entry.buffer?.type),
    ['uniform', 'read-only-storage', 'read-only-storage', 'read-only-storage'],
  )
  // The cut's four record tables, in group 0 at the bindings the culling reads them at.
  assert.deepEqual(
    dagReadLayoutEntries()
      .map(({ binding }) => binding)
      .sort((a, b) => a - b),
    [DAG_BINDING.nodes, DAG_BINDING.worlds, DAG_BINDING.frames, DAG_BINDING.tree].sort(
      (a, b) => a - b,
    ),
  )
  assert.ok(topLevelNames(SCENE_TRACE_PROBE).includes('treeMember'), 'the tree is declared')
})

test('its bind group entries name the four buffers at the layout entries’ bindings', () => {
  const [params, nodes, triangles, table] = [{}, {}, {}, {}] as GPUBuffer[]
  const entries = sceneTraceBindEntries({ params, nodes, triangles, table }, PROBE_FIRST)
  assert.deepEqual(
    entries.map(({ binding }) => binding),
    sceneTraceLayoutEntries(PROBE_FIRST).map(({ binding }) => binding),
  )
  assert.deepEqual(
    entries.map(({ resource }) => (resource as GPUBufferBinding).buffer),
    [params, nodes, triangles, table],
  )
})

test('the parameters are laid as WGSL lays the struct: sixteen-byte rounded, the culling view after the eye', () => {
  const P = SCENE_TRACE_PARAMS
  assert.equal(P.words % 4, 0)
  assert.deepEqual([P.at.eyeXY, P.at.eyeZ, P.at.cullRadius], [0, 4, 6])
  assert.ok(P.at.placementWord < P.words)
})

test('a ray’s flags choose what it meets: the first hit, the front faces, the shadow rules', () => {
  const flag = (name: string, value: number) =>
    assert.match(SCENE_TRACE_PROBE, new RegExp(`const ${name}:u32=${value}u;`))
  // The literals pin the ray flags' ABI on purpose: any-hit 1, cull-front 2, shadow 4.
  flag('ST_ANY_HIT', 1)
  flag('ST_CULL_FRONT', 2)
  flag('ST_SHADOW', 4)
  // An any-hit ray answers the hit alone: its normal is not turned into the world.
  assert.match(SCENE_TRACE_PROBE, /if\(best\.hit&&\(ray\.flags&ST_ANY_HIT\)==0u\)\{/)
  assert.match(SCENE_TRACE_PROBE, /\(stRay\.flags&ST_CULL_FRONT\)!=0u&&front&&!inst\.twoSided/)
  assert.match(
    SCENE_TRACE_PROBE,
    /\(stRay\.flags&ST_SKIP_TRANSLUCENT\)!=0u&&\(flags&ST_TRANSLUCENT\)!=0u/,
  )
  assert.match(
    SCENE_TRACE_PROBE,
    /\(stRay\.flags&ST_SHADOW\)!=0u&&\(entry\.mark&ST_CASTS_NO_SHADOW\)!=0u/,
  )
})

test('a ray’s flags also cull the back faces, skip the translucent primitives and pass the near hits by', () => {
  const flag = (name: string, value: number) =>
    assert.match(SCENE_TRACE_PROBE, new RegExp(`const ${name}:u32=${value}u;`))
  // The literals pin the ABI on purpose: they follow any-hit 1, cull-front 2, shadow 4.
  flag('ST_CULL_BACK', 8)
  flag('ST_SKIP_TRANSLUCENT', 16)
  flag('ST_SKIP_NEAR', 32)
  // The back faces of a primitive that is not two-sided, as the front faces are.
  assert.match(SCENE_TRACE_PROBE, /\(stRay\.flags&ST_CULL_BACK\)!=0u&&!front&&!inst\.twoSided/)
  // The near hits: a two-sided primitive's under its distance, a one-sided one's back face under its own; after the ray's tMin.
  assert.match(
    SCENE_TRACE_PROBE,
    /\(stRay\.flags&ST_SKIP_NEAR\)!=0u&&select\(!front&&t<stParams\.skipBackFaceDistance,t<stParams\.skipTwoSidedDistance,inst\.twoSided\)/,
  )
  const triangle = SCENE_TRACE_PROBE.slice(SCENE_TRACE_PROBE.indexOf('fn stTriangle'))
  assert.ok(triangle.indexOf('t<stRay.tMin') < triangle.indexOf('ST_SKIP_NEAR'))
  // A hit passed by was a step of the trace, as one culled is.
  assert.ok(triangle.indexOf('!stStep()') < triangle.indexOf('ST_CULL_BACK'))
  // The translucent primitives are left out by their own flag, not the shadow's.
  assert.doesNotMatch(SCENE_TRACE_PROBE, /shadow&&\(flags&ST_TRANSLUCENT\)/)
})

test('the parameters end with the two distances a ray that passes near hits by reads, in metres', () => {
  const P = SCENE_TRACE_PARAMS
  assert.deepEqual(
    [P.at.skipTwoSidedDistance - P.at.skipBackFaceDistance, P.at.skipBackFaceDistance],
    [1, P.at.placementWord + 1],
  )
  assert.ok(P.at.skipTwoSidedDistance < P.words)
  assert.match(P.wgsl, /skipBackFaceDistance:f32,skipTwoSidedDistance:f32,/)
})

test('the node is loaded in two parts, the head for the box and the rest once the box is met; a triangle is three vec4u', () => {
  assert.match(SCENE_TRACE_PROBE, /var nd=stNodeHead\(node\);/)
  assert.match(SCENE_TRACE_PROBE, /nd=stNodeOpen\(nd,node\);/)
  assert.doesNotMatch(SCENE_TRACE_PROBE, /stCorner|nd\.grid\d\[/)
})
