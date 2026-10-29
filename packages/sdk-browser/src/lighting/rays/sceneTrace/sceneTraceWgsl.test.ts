// The scene trace's WGSL text assembles into a module that names nothing it does not declare, at
// the bindings its layout entries describe, with the file's words (`rayTracingFile.ts`) and the
// cut's tables (`DAG_READ_TABLES_WGSL`) it reads; the parameters' uniform is laid as WGSL lays it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_LEAF_OFFSET_MASK,
  RAY_TRACING_MIN_EXPONENT,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_BYTES,
  RAY_TRACING_STACK,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_WIDTH,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import { dagReadLayoutEntries, DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { assertProgramAssembles, topLevelNames } from '../../../gpu/core/wgslNames.fixture.ts'
import { PROBE_FIRST, PROBE_GROUP, SCENE_TRACE_PROBE } from './sceneTraceProbe.fixture.ts'
import {
  SCENE_TRACE_CELL_DRAWN,
  SCENE_TRACE_PARAMS,
  SCENE_TRACE_WORLD_BIT,
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
    /struct StHit\{distance:f32,placement:u32,record:u32,triangle:u32,object:u32,normal:vec3f,bary:vec2f,frontFace:bool,twoSided:bool,hit:bool,\}/,
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

test('the parameters end with the culling: the table word of its flags, its mode and switches, the view’s direction', () => {
  const P = SCENE_TRACE_PARAMS
  assert.deepEqual(
    [P.at.cullMode - P.at.cullWord, P.at.cullFlags - P.at.cullMode, P.at.viewDirection % 4],
    [1, 1, 0],
  )
  assert.ok(P.at.viewDirection + 3 <= P.words)
  assert.match(P.wgsl, /cullWord:u32,cullMode:u32,cullFlags:u32,viewDirection:vec3f,/)
})

test('a placement the image’s culling left out is passed by before anything of it is read, and no ray culls by distance or angle', () => {
  assert.match(
    SCENE_TRACE_PROBE,
    /fn stEnter\(w:u32,best:StHit,inverse:vec3f\)->StHit\{\n if\(stDone\|\|w>=stParams\.placements\|\|stTable\[stParams\.cullWord\+w\]!=0u\)\{return best;\}\n let slot=/,
  )
  const enter = SCENE_TRACE_PROBE.slice(SCENE_TRACE_PROBE.indexOf('fn stEnter'))
  assert.doesNotMatch(enter, /stParams\.cullRadius|culledTanAngleSq/)
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
  // A mesh translucent whole is left out of every ray; a ray that asks it leaves the other translucent primitives out where the image tests the mesh sections' visibility, and meets them as opaque ones else.
  assert.match(
    SCENE_TRACE_PROBE,
    /fn stSkipsTranslucent\(flags:u32\)->bool\{\n return \(\(flags&ST_ALL_TRANSLUCENT\)!=0u&&\(stRay\.flags&ST_MEET_TRANSLUCENT\)==0u\)\|\|\(\(stRay\.flags&ST_SKIP_TRANSLUCENT\)!=0u&&stParams\.skipsTranslucentSections!=0u&&\(flags&ST_TRANSLUCENT\)!=0u\);/,
  )
  assert.match(SCENE_TRACE_PROBE, /\n if\(stSkipsTranslucent\(flags\)\)\{return best;\}/)
  assert.match(
    SCENE_TRACE_PROBE,
    /\(stRay\.flags&ST_SHADOW\)!=0u&&\(entry\.mark&ST_CASTS_NO_SHADOW\)!=0u/,
  )
})

test('a mesh translucent whole is skipped whatever the option, a translucent primitive of a mixed mesh is met as opaque only with it off', () => {
  // The function's own text, run: its constants read from the program, the ray's flags and the option given.
  const body = /fn stSkipsTranslucent\(flags:u32\)->bool\{\n return (.*);\n\}/.exec(
    SCENE_TRACE_PROBE,
  )?.[1]
  assert.ok(body)
  const constants = Object.fromEntries(
    [...SCENE_TRACE_PROBE.matchAll(/const (ST_\w+):u32=(\d+)u;/g)].map(([, name, value]) => [
      name,
      Number(value),
    ]),
  )
  const run = new Function(
    ...Object.keys(constants),
    'stRay',
    'stParams',
    'flags',
    `return ${body.replace(/(\d+)u\b/g, '$1')};`,
  )
  const skips = (flags: number, ray: number, option: boolean) =>
    run(
      ...Object.values(constants),
      { flags: ray },
      { skipsTranslucentSections: option ? 1 : 0 },
      flags,
    )
  const [translucent, whole] = [
    RAY_TRACING_FLAG_TRANSLUCENT,
    RAY_TRACING_FLAG_TRANSLUCENT | RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  ]
  const asks = constants.ST_SKIP_TRANSLUCENT
  for (const option of [false, true]) {
    // Translucent whole: out of the rays that ask and of those that do not.
    assert.equal(skips(whole, asks, option), true, `whole, asking, option ${option}`)
    assert.equal(skips(whole, 0, option), true, `whole, not asking, option ${option}`)
    // An opaque primitive is never left out.
    assert.equal(skips(0, asks, option), false, `opaque, option ${option}`)
  }
  // A translucent primitive of a mesh with an opaque one: left out only where the image tests the sections, and the ray asks.
  assert.equal(skips(translucent, asks, true), true)
  assert.equal(skips(translucent, asks, false), false, 'met as opaque with the option off')
  assert.equal(skips(translucent, 0, true), false, 'a ray that does not ask meets it')
})

test('a ray’s flags also cull the back faces, skip the translucent primitives and pass the near hits by', () => {
  const flag = (name: string, value: number) =>
    assert.match(SCENE_TRACE_PROBE, new RegExp(`const ${name}:u32=${value}u;`))
  // The literals pin the ABI on purpose: they follow any-hit 1, cull-front 2, shadow 4.
  flag('ST_CULL_BACK', 8)
  flag('ST_SKIP_TRANSLUCENT', 16)
  flag('ST_SKIP_NEAR', 32)
  flag('ST_MEET_WORLD_SPACE', 64)
  flag('ST_WORLD_SPACE_ROOT', 2048)
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

test('the parameters end with the two distances a ray that passes near hits by reads, in metres, the culling’s and the switch of the mesh sections’ visibility test', () => {
  const P = SCENE_TRACE_PARAMS
  assert.deepEqual(
    [P.at.skipTwoSidedDistance - P.at.skipBackFaceDistance, P.at.skipBackFaceDistance],
    [1, P.at.cells + 1],
  )
  assert.ok(P.at.skipTwoSidedDistance < P.words)
  assert.match(P.wgsl, /skipBackFaceDistance:f32,skipTwoSidedDistance:f32,/)
  assert.match(P.wgsl, /viewDistanceScale:f32,skipsTranslucentSections:u32,/)
})

test('the node is loaded in two parts, the head for the box and the rest once the box is met; a triangle is three vec4u', () => {
  assert.match(SCENE_TRACE_PROBE, /var nd=stNodeHead\(node\);/)
  assert.match(SCENE_TRACE_PROBE, /nd=stNodeOpen\(nd,node\);/)
  assert.doesNotMatch(SCENE_TRACE_PROBE, /stCorner|nd\.grid\d\[/)
})

test('a placement of the world DAG enters the world’s directory, which enters the actors whose cell the cut draws', () => {
  const constant = (name: string, value: number) =>
    assert.match(SCENE_TRACE_PROBE, new RegExp(`const ${name}:u32=${value}u;`))
  constant('ST_WORLD_BIT', SCENE_TRACE_WORLD_BIT)
  constant('ST_CELL_DRAWN', SCENE_TRACE_CELL_DRAWN)
  constant('ST_OBJECT_MASK', 0x7fffffff)
  // The table's word is the directory by its bit, its instance under it; its cells' words start at the parameters'.
  assert.match(SCENE_TRACE_PROBE, /let record=select\(slot,stParams\.worldRecord,world\);/)
  assert.match(
    SCENE_TRACE_PROBE,
    /let cells=select\(NO_INDEX,stParams\.cellsWord\+\(slot&~ST_WORLD_BIT\)\*stParams\.cells,world\);/,
  )
  assert.match(
    SCENE_TRACE_PROBE,
    /if\(world\)\{hit=stDirectory\(entry\.origin,entry\.direction,best\.distance,inst\);\}/,
  )
  // An actor is entered where its cell's word says the cut draws it, before its record is read; its hit names the cell's object.
  const actor = SCENE_TRACE_PROBE.slice(SCENE_TRACE_PROBE.indexOf('fn stActor'))
  assert.match(
    actor,
    /let cell=stTable\[dir\.cells\+tail\[ST_TAIL_CELL\]\];\n if\(\(cell&ST_CELL_DRAWN\)==0u\)\{return best;\}/,
  )
  assert.ok(actor.indexOf('ST_CELL_DRAWN') < actor.indexOf('ST_RECORD_NODES'))
  assert.match(actor, /\(flags&ST_TWO_SIDED\)!=0u,\(cell&ST_OBJECT_MASK\)-1u,NO_INDEX\);/)
  assert.match(actor, /nodes==0u\|\|stSkipsTranslucent\(flags\)/)
  // An ordinary placement's hit is told by the placement.
  assert.match(SCENE_TRACE_PROBE, /entry\.mirrored,\(flags&ST_TWO_SIDED\)!=0u,w,cells\);/)
})

test('the parameters name the directory and where the cells’ words lie', () => {
  const P = SCENE_TRACE_PARAMS
  assert.deepEqual([P.at.cellsWord - P.at.worldRecord, P.at.cells - P.at.cellsWord], [1, 1])
  assert.match(P.wgsl, /worldRecord:u32,cellsWord:u32,cells:u32,/)
})

test('the walk’s stack holds what the compiler lets a walk need, and a node’s least exponent is the compiler’s', () => {
  // Both walks, the structures' and the directory's, are given the stack the compiler bounds the need of every tree by.
  const stacks = SCENE_TRACE_PROBE.match(/var stack:array<u32,(\d+)u?>;/g) ?? []
  assert.equal(stacks.length, 2)
  for (const stack of stacks) assert.ok(stack.includes(`array<u32,${RAY_TRACING_STACK}u>`), stack)
  // The scale of a node is read at no exponent under the file's least, by the constant, never a literal.
  assert.match(
    SCENE_TRACE_PROBE,
    new RegExp(`const ST_MIN_EXPONENT:i32=${RAY_TRACING_MIN_EXPONENT};`),
  )
  assert.equal(SCENE_TRACE_PROBE.match(/,ST_MIN_EXPONENT\)/g)?.length, 3)
  assert.doesNotMatch(SCENE_TRACE_PROBE, /,-126\)/)
})
