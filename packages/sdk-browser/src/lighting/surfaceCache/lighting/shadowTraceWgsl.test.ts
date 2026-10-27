// The shadow trace's programs assemble into modules that name nothing they do not declare, at the bindings their layout
// entries describe, beside the scene trace's group and the cut's tables.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import {
  SHADOW_ARGS_BINDINGS,
  SHADOW_ARGS_ENTRY,
  SHADOW_ARGS_WGSL,
  SHADOW_TRACE_BINDINGS,
  SHADOW_TRACE_COLOURED_WGSL,
  SHADOW_TRACE_ENTRY,
  SHADOW_TRACE_SCENE,
  SHADOW_TRACE_WGSL,
} from './shadowTraceWgsl.ts'

for (const [name, text, entry] of [
  ['the arguments', SHADOW_ARGS_WGSL, SHADOW_ARGS_ENTRY],
  ['the trace', SHADOW_TRACE_WGSL, SHADOW_TRACE_ENTRY],
  ['the trace over coloured masks', SHADOW_TRACE_COLOURED_WGSL, SHADOW_TRACE_ENTRY],
] as const)
  test(`${name}: the program assembles, every name declared once, none reserved, the braces paired`, () => {
    assertProgramAssembles(text, entry)
  })

test('the arguments read the traces’ count and write the context’s header', () => {
  const A = SHADOW_ARGS_BINDINGS
  assert.deepEqual(wgslBufferBindings(SHADOW_ARGS_WGSL), [
    { binding: 0, type: 'uniform' },
    { binding: A.tables, type: 'read-only-storage' },
    { binding: A.context, type: 'storage' },
    { binding: A.traces, type: 'read-only-storage' },
  ])
  assert.match(
    SHADOW_ARGS_WGSL,
    /setArgs\(ARGS_SHADOW_TRACES,groupGrid\(ceilDiv\(traces\[0\],64u\)\)\)/,
  )
})

test('the trace binds its buffers clear of the cut’s tables, which keep the culling’s bindings', () => {
  const T = SHADOW_TRACE_BINDINGS
  const cut = [DAG_BINDING.nodes, DAG_BINDING.worlds, DAG_BINDING.frames, DAG_BINDING.tree]
  assert.deepEqual(wgslBufferBindings(SHADOW_TRACE_WGSL), [
    { binding: 0, type: 'uniform' },
    { binding: T.tables, type: 'read-only-storage' },
    { binding: T.traces, type: 'read-only-storage' },
    { binding: T.masks, type: 'storage' },
    { binding: T.lights, type: 'read-only-storage' },
    { binding: T.lightTiles, type: 'read-only-storage' },
  ])
  // Five buffers of the first group and the scene trace's three in the second: the guaranteed limit of eight.
  assert.equal(
    wgslBufferBindings(SHADOW_TRACE_WGSL).filter(({ type }) => type !== 'uniform').length,
    5,
  )
  const own = [0, T.tables, T.traces, T.depth, T.normal, T.masks, T.lights, T.lightTiles]
  for (const binding of cut) assert.ok(!own.includes(binding), `binding ${binding}`)
  // The scene trace's uniform and three buffers are group 1, from binding 0.
  assert.deepEqual([SHADOW_TRACE_SCENE.group, SHADOW_TRACE_SCENE.first], [1, 0])
  assert.match(SHADOW_TRACE_WGSL, /@group\(1\) @binding\(0\) var<uniform> stParams/)
})

test('the ray is cast as the shadow of a texel: any hit, front faces culled unless all are two-sided', () => {
  assert.match(SHADOW_TRACE_WGSL, /var flags=ST_ANY_HIT\|ST_SHADOW\|ST_SKIP_TRANSLUCENT;/)
  assert.match(SHADOW_TRACE_WGSL, /if\(!lgFlag\(FLAG_FORCE_TWO_SIDED\)\)\{flags\|=ST_CULL_FRONT;\}/)
  // A ray that stopped before its walk was whole counts as blocked.
  assert.match(SHADOW_TRACE_WGSL, /return hit\.hit\|\|!stComplete;/)
})

test('a texel at the lamp, or within the end bias of it, casts no ray: it is not blocked, and no direction is taken of a zero offset', () => {
  const body = SHADOW_TRACE_WGSL.slice(SHADOW_TRACE_WGSL.indexOf('fn shadowRayBlocked'))
  const guard = body.indexOf('if(span<=0.0){return false;}')
  assert.ok(guard > 0)
  assert.ok(guard < body.indexOf('normalize(offset)'), 'the guard comes before the direction')
  assert.ok(guard < body.indexOf('stTrace('), 'the guard comes before the trace')
})

test('over coloured masks the trace settles a texel as over grey ones: the ray’s answer is 0 or all of the factor, whatever its colour, and a quad’s others follow it', () => {
  // The trace is one text; the constants of the format give it 15 bits of factor under the complete bit, two bytes an entry.
  assert.match(SHADOW_TRACE_COLOURED_WGSL, /const SHADOW_FACTOR_MAX:u32=32767u;/)
  assert.match(SHADOW_TRACE_COLOURED_WGSL, /const SHADOW_COMPLETE:u32=32768u;/)
  assert.match(SHADOW_TRACE_COLOURED_WGSL, /const SHADOW_RAY_BITS:u32=16u;/)
  assert.match(SHADOW_TRACE_WGSL, /const SHADOW_COMPLETE:u32=128u;/)
  assert.match(SHADOW_TRACE_COLOURED_WGSL, /atomicXor\(&masks\[/)
  assert.match(
    SHADOW_TRACE_COLOURED_WGSL,
    /setMaskByte\(lightTile,coord,byte,select\(byte,0u,blocked\)\|SHADOW_COMPLETE\);/,
  )
  assert.match(
    SHADOW_TRACE_COLOURED_WGSL,
    /let shadowed=blocked\|\|\(byte&SHADOW_FACTOR_MAX\)==0u;/,
  )
})
