// The screen probes' scene stage cast through the scene's triangles (`traceTracedWgsl.ts`): the program assembles and binds clear of the cut's tables, and its ray starts as the reference starts it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { withinDefaults } from '../../../gpu/core/stageLimits.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { SELF_INTERSECTION } from '../../surfaceCache/lighting/layout.ts'
import { IMAGE_READS } from './imageReads.fixture.ts'
import { screenProbeFlags } from './modeFlags.ts'
import { SCREEN_PROBE_FLAGS } from './screenProbeLayout.ts'
import { traceSceneShader } from './traceSceneWgsl.ts'
import {
  TRACE_TRACED_BINDINGS,
  TRACE_TRACED_FOG,
  TRACE_TRACED_HIT,
  TRACE_TRACED_SCENE,
  traceTracedEntries,
  traceTracedSceneEntries,
  traceTracedShader,
} from './traceTracedWgsl.ts'
import { reflectionSceneLayout } from '../../reflections/reflectionPipelines.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

const PROGRAM = traceTracedShader(8, [4, 4], false)
const FOG_PROGRAM = traceTracedShader(8, [4, 4], true)

/** What an image with all of it can read, its thicknesses the traced stage's tests are written at. */
const READS = { ...IMAGE_READS, relativeThickness: 0.03, historyThickness: 0.004 }

test('the traced scene stage assembles: its names declared once, none reserved, the braces paired', () => {
  assertProgramAssembles(PROGRAM, 'traceTriangles')
  assertProgramAssembles(FOG_PROGRAM, 'traceTriangles')
})

test('the traced stage binds clear of the cut’s tables, which keep the culling’s bindings, and the scene trace in its own group', () => {
  const T = TRACE_TRACED_BINDINGS.at
  const cut = [
    DAG_BINDING.nodes,
    DAG_BINDING.worlds,
    DAG_BINDING.frames,
    DAG_BINDING.tree,
    DAG_BINDING.previous,
  ]
  // The layers of the cards their library declares and the layout leaves out lie between the cards' first binding and the last layer a hit reads.
  const library = Array.from({ length: 8 }, (_, at) => TRACE_TRACED_HIT.cards + at)
  const own = [
    ...Object.values(T),
    TRACE_TRACED_HIT.cards,
    TRACE_TRACED_HIT.cards + 1,
    TRACE_TRACED_HIT.cards + 7,
    TRACE_TRACED_HIT.instances,
    ...Object.values(TRACE_TRACED_FOG),
  ]
  for (const binding of cut) assert.ok(!own.includes(binding), `binding ${binding}`)
  assert.equal(new Set(own).size, own.length, 'no binding twice')
  for (const binding of Object.values(TRACE_TRACED_FOG))
    assert.ok(
      !library.includes(binding),
      `the fog’s binding ${binding} is clear of the cards’ layers`,
    )
  for (const fog of [false, true]) {
    const held = traceTracedEntries(fog).map(({ binding }) => binding)
    assert.equal(new Set(held).size, held.length, 'the layout holds no binding twice')
    for (const binding of cut) assert.ok(held.includes(binding), `the cut’s table ${binding}`)
    for (const binding of Object.values(TRACE_TRACED_FOG))
      assert.equal(
        held.includes(binding),
        fog,
        `the fog’s binding ${binding} is held only where it is on`,
      )
  }
  assert.deepEqual([TRACE_TRACED_SCENE.group, TRACE_TRACED_SCENE.first], [2, 0])
  assert.match(PROGRAM, /@group\(2\) @binding\(0\) var<uniform> stParams/)
  // The global distance field is neither marched nor bound.
  assert.doesNotMatch(PROGRAM, /gdf|Gdf|scGlobalHit/)
  assert.match(traceSceneShader(8, [4, 4], false), /gdfTraceRay/)
})

test('the traced stage’s group, the reflection group it reads and the scene trace’s hold to the sampled textures, the storage buffers and the storage textures a stage allows, with the fog on the rays or not', () => {
  // The stage binds the reflection group of the scene stages (`reflectionSceneLayout`) and the scene trace's beside its own.
  const group = reflectionSceneLayout(fakeDevice().device)
  for (const fog of [false, true])
    withinDefaults(
      [
        {
          bindGroupLayouts: [
            { entries: traceTracedEntries(fog) },
            group,
            { entries: traceTracedSceneEntries() },
          ] as unknown as GPUBindGroupLayout[],
        },
      ],
      `the traced stage${fog ? ' with the fog' : ''}`,
    )
})

test('the hit’s placement has a speed to measure only where a pose moved since the last drawn frame: the flag says so, and the stage skips the pose reads else', () => {
  assert.match(
    PROGRAM,
    /if\(spFlag\(SP_FLAG_POSES_MOVING\)\)\{out\.speed=length\(stHitVelocity\(hit\.placement,/,
  )
  const F = SCREEN_PROBE_FLAGS
  const settings = screenProbeSettings()
  assert.equal(screenProbeFlags(settings, { ...READS, posesMoving: false }) & F.posesMoving, 0)
  assert.equal(
    screenProbeFlags(settings, { ...READS, posesMoving: true }) & F.posesMoving,
    F.posesMoving,
  )
})

test('the ray starts as the reference starts it: off the surface along the normal, no nearer than the bias, pulled back only if it did not reach its end', () => {
  const ray = PROGRAM.slice(PROGRAM.indexOf('fn spTracedRay('), PROGRAM.indexOf('@compute'))
  const steps = [
    'var rayBias=sp.traced.x;',
    'if(probe.hair){rayBias=max(rayBias,sp.traced.z);}',
    'var tMin=max(missed,rayBias);',
    'let tMax=max(reach,rayBias);',
    'if(!(tMin<tMax)){return out;}',
    'tMin=max(tMin-sp.traced.w,rayBias);',
    'let origin=spTracedStart(probe,d);',
  ]
  let at = -1
  for (const step of steps) {
    const found = ray.indexOf(step)
    assert.ok(found > at, `${step} follows the step before it`)
    at = found
  }
  assert.match(
    ray,
    /let hit=stTraceAvoiding\(origin-view\.display\.yzw,d,tMin,tMax,u32\(sp\.tracedHit\.z\)\);/,
  )
  assert.doesNotMatch(ray, /stTrace\(/, 'the one avoiding trace is the shared helper')
  assert.match(PROGRAM, /var flags=ST_SKIP_TRANSLUCENT;/)
  assert.doesNotMatch(ray, /ST_SHADOW/)
})

test('the ray starts off the surface along its normal by the normal bias, the normal turned toward a ray that goes the other way on a probe with backface diffuse light', () => {
  const { spTracedStart } = shaderRun<{ spTracedStart: (probe: object, d: Vec3) => Vec3 }>(
    PROGRAM,
    ['spTracedStart'],
    { sp: { traced: [0, 0.25, 0, 0] } },
  )
  const probe = (foliage: boolean) => ({ P: [1, 2, 3], N: [0, 1, 0], foliage })
  assert.deepEqual(spTracedStart(probe(false), [0, 1, 0]), [1, 2.25, 3])
  assert.deepEqual(
    spTracedStart(probe(false), [0, -1, 0]),
    [1, 2.25, 3],
    'a plain surface keeps its normal',
  )
  assert.deepEqual(
    spTracedStart(probe(true), [0, -1, 0]),
    [1, 1.75, 3],
    'a sheet’s normal faces the ray',
  )
})

test('the self-intersection modes are the reference’s: 0 culls the back faces, 1 traces again once, 2 passes the near hits', () => {
  assert.deepEqual(SELF_INTERSECTION, { cull: 0, retrace: 1, skip: 2 })
  for (const [name, value] of [
    ['ST_AVOID_CULL', 0],
    ['ST_AVOID_RETRACE', 1],
    ['ST_AVOID_SKIP', 2],
  ] as const)
    assert.match(PROGRAM, new RegExp(`const ${name}:u32=${value}u;`))
  assert.match(PROGRAM, /if\(avoid==ST_AVOID_CULL\)\{flags\|=ST_CULL_BACK;\}/)
  assert.match(PROGRAM, /if\(avoid>=ST_AVOID_SKIP\)\{flags\|=ST_SKIP_NEAR;\}/)
  assert.match(PROGRAM, /if\(avoid!=ST_AVOID_RETRACE\|\|!hit\.hit\|\|trace==1u\)\{break;\}/)
  assert.match(
    PROGRAM,
    /hit\.distance<stParams\.skipTwoSidedDistance\)\{past=hit\.distance\+0\.01\/100\.0;\}/,
  )
  assert.match(
    PROGRAM,
    /!hit\.frontFace&&hit\.distance<stParams\.skipBackFaceDistance\)\{past=stParams\.skipBackFaceDistance;\}/,
  )
})
