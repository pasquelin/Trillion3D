// The path tracer's programs, assembled as the device is given them: every name declared, none reserved, every entry present, the bindings the host lays out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { PT_ACCUMULATE_ENTRIES, PT_ACCUMULATE_WGSL } from './accumulateProgram.ts'
import { PT_AIR_DEPTH_ENTRY, PT_AIR_DEPTH_WGSL } from './airDepthWgsl.ts'
import { PT_ARGS_ENTRY, PT_ARGS_WGSL } from './argsProgram.ts'
import { PT_GRID_BUILD_WGSL, PT_SKY_BUILD_WGSL } from './buildPrograms.ts'
import { PT_LIGHT_GRID_ENTRY } from './lightGridWgsl.ts'
import { PT_SKY_COMPENSATE_ENTRY, PT_SKY_MIP_ENTRY, PT_SKY_PREPARE_ENTRY } from './skyWgsl.ts'
import { shadeHitProgram } from './shadeHitWgsl.ts'
import {
  PT_FINISH_ENTRY,
  PT_TRACE_ENTRIES,
  ptFinishProgram,
  ptTraceProgram,
} from './traceProgram.ts'

test('the trace program has every entry and binds eight storage buffers at most: the paths, the queue and the scene trace’s geometry and table, the colour atlas’s page table, the placements and the hits', () => {
  const text = ptTraceProgram()
  for (const entry of Object.values(PT_TRACE_ENTRIES))
    assertProgramAssembles(text, entry, `the trace ${entry}`)
  const storage = [...text.matchAll(/var<storage[^>]*>\s*(\w+)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(storage)].sort(), [
    'colorPages',
    'ptHits',
    'ptPlacements',
    'ptQueue',
    'ptStates',
    'stGeometry',
    'stTable',
  ])
})

test('the trace reads the samples a pixel has gathered from the error chain, not from the paths’ states', () => {
  assert.match(
    ptTraceProgram(),
    /ptCreatePath\(pixel,select\(0u,u32\(textureLoad\(ptVariance,vec2i\(pixel\),0\)\.z\),ptView\.image\.w>0u\)\)/,
  )
})

test('the finish program has its entry and binds eight storage buffers: the paths, the queue, the lights, the scene trace’s three, the hits and the materials', () => {
  const text = ptFinishProgram()
  assertProgramAssembles(text, PT_FINISH_ENTRY, 'the finish')
  const storage = [...text.matchAll(/var<storage[^>]*>\s*(\w+)/g)].map((m) => m[1])
  assert.equal(new Set(storage).size, 8)
})

test('the arguments program has its entry and binds two storage buffers, the queue it reads and the arguments it writes', () => {
  assertProgramAssembles(PT_ARGS_WGSL, PT_ARGS_ENTRY, 'the arguments')
  const storage = [...PT_ARGS_WGSL.matchAll(/var<storage[^>]*>\s*(\w+)/g)].map((m) => m[1])
  assert.deepEqual(storage.sort(), ['ptArgsOut', 'ptQueue'])
})

test('the accumulation, light grid and sky table programs have every entry', () => {
  for (const entry of Object.values(PT_ACCUMULATE_ENTRIES))
    assertProgramAssembles(PT_ACCUMULATE_WGSL, entry, `the accumulation ${entry}`)
  assertProgramAssembles(PT_GRID_BUILD_WGSL, PT_LIGHT_GRID_ENTRY, 'the light grid')
  for (const entry of [PT_SKY_PREPARE_ENTRY, PT_SKY_MIP_ENTRY, PT_SKY_COMPENSATE_ENTRY])
    assertProgramAssembles(PT_SKY_BUILD_WGSL, entry, `the sky table ${entry}`)
})

test('the programs name no word of the reference', () => {
  const texts = [
    ptTraceProgram(),
    ptFinishProgram(),
    shadeHitProgram(),
    PT_ARGS_WGSL,
    PT_ACCUMULATE_WGSL,
    PT_GRID_BUILD_WGSL,
    PT_SKY_BUILD_WGSL,
  ]
  for (const text of texts) assert.doesNotMatch(text, /Unreal|Epic|Lumen|Nanite|Substrate/)
})

test('the bounces past the compaction depth go on over the last compacted list, and a path that ended is left alone', () => {
  const trace = ptTraceProgram()
  assert.match(trace, /fn ptCountAt\(bounce:u32\)->u32\{return min\(bounce,ptView\.counts\.z\);\}/)
  assert.match(
    ptFinishProgram(),
    /else if\(keep&&bounce<ptView\.counts\.z\)\{ptPush\(bounce\+1u,index\);\}/,
  )
  assert.match(trace, /if\(path\.dead\)\{\s*ptEndHit\(index\);/)
  assert.match(PT_ARGS_WGSL, /min\(bounce,ptView\.counts\.z\)/)
  assert.match(
    shadeHitProgram(),
    /fn ptCountAt\(bounce:u32\)->u32\{return min\(bounce,ptView\.counts\.z\);\}/,
  )
})

test("a ray that went through a surface is traced again in the same bounce: every stage reads the round's list, the finish sends the path back, the arguments empty the list it fills", () => {
  for (const text of [ptTraceProgram(), ptFinishProgram(), shadeHitProgram(), PT_ARGS_WGSL]) {
    assert.match(text, /fn ptRoundCount\(bounce:u32\)->u32/)
    assert.match(text, /select\(ptListAt\(bounce\),ptRetryListAt\(turn\),turn>0u\)/)
  }
  assert.match(ptFinishProgram(), /if\(ptPassedThrough\)\{ptPushRetry\(index\);\}/)
  assert.match(PT_ARGS_WGSL, /atomicStore\(&ptQueue\[ptRetryCountAt\(turn\+1u\)\],0u\)/)
})

test('the traced atmosphere’s optical depth program has its entry and the trace and finish programs bind its block and table', () => {
  assertProgramAssembles(PT_AIR_DEPTH_WGSL, PT_AIR_DEPTH_ENTRY, 'the air optical depth')
  for (const text of [ptTraceProgram(), ptFinishProgram()]) {
    assert.match(text, /var<uniform> ptAtmo:PtAtmo/)
    assert.match(text, /var ptAirDepth:texture_2d<f32>/)
    assert.match(text, /fn ptAirTrack\(/)
  }
})

test('the finish program holds the view of the payload and the lamps’ light of a volume, and the trace keeps the throughput the walk begins with', () => {
  const finish = ptFinishProgram()
  assertProgramAssembles(finish, 'ptVisualize', 'the view of the payload')
  assert.match(finish, /fn ptShowHit\(/)
  assert.match(finish, /fn ptVolumeLights\(/)
  assert.match(finish, /if\(medium&&ptAirVolumeLights\(\)\)\{/)
  assert.match(
    ptTraceProgram(),
    /if\(ptAirVolumeLights\(\)\)\{\(\*path\)\.segment=\(\*path\)\.throughput;\}/,
  )
})
