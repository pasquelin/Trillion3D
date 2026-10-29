import assert from 'node:assert/strict'
import test from 'node:test'
import { SCREEN_MARCH_WGSL } from '../../../visibility/hiz/gpu/screenMarch.ts'
import {
  SELF_SHADOW_ENTRIES,
  SELF_SHADOW_MAX_LIGHTS,
  SELF_SHADOW_MERGE_ENTRY,
  selfShadowMergeProgram,
  selfShadowProgram,
} from './selfShadowWgsl.ts'

test('each kernel is a program with its entry and the engine’s march', () => {
  for (const entry of Object.values(SELF_SHADOW_ENTRIES)) {
    const code = selfShadowProgram(entry, 'none')
    assert.ok(code.includes(`fn ${entry}(`), entry)
  }
  assert.ok(selfShadowProgram(SELF_SHADOW_ENTRIES.trace, 'none').includes('fn screenMarch('))
})

test('the march gives up on occupancy only under the polyfill', () => {
  const trace = SELF_SHADOW_ENTRIES.trace
  assert.ok(!selfShadowProgram(trace, 'none').includes('screenMarchLane'))
  const polyfill = selfShadowProgram(trace, 'polyfill')
  assert.ok(polyfill.includes('screenMarchLane=lane;'))
  assert.ok(polyfill.includes('params.counts.w'))
})

test('the uniform holds a record a light', () => {
  assert.ok(
    selfShadowProgram(SELF_SHADOW_ENTRIES.upsample, 'none').includes(
      `lights:array<vec4f,${SELF_SHADOW_MAX_LIGHTS}>`,
    ),
  )
})

test('the trace walks the smooth full-resolution depth, and no other march does', () => {
  const trace = selfShadowProgram(SELF_SHADOW_ENTRIES.trace, 'none')
  assert.ok(trace.includes('fn screenBilinearDepth('))
  assert.ok(trace.includes('let zPlane=mip>base;'))
  assert.ok(!SCREEN_MARCH_WGSL(0, 1).name.includes('smooth'))
})

test('the trace reaches a local light by its rank and the merge keeps the first-person pixels', () => {
  const trace = selfShadowProgram(SELF_SHADOW_ENTRIES.trace, 'none')
  assert.ok(trace.includes('lightReaches(rank,P)'))
  assert.ok(trace.includes('directLights.items[rank].positionRange'))
  const merge = selfShadowMergeProgram()
  assert.ok(merge.includes(`fn ${SELF_SHADOW_MERGE_ENTRY}(`))
  assert.ok(merge.includes('discard;'))
})

test('a run covers a window of the image and starts at a layer of the mask', () => {
  const trace = selfShadowProgram(SELF_SHADOW_ENTRIES.trace, 'none')
  assert.ok(trace.includes('window:vec4u'))
  assert.ok(trace.includes('gid.xy+select(params.window.xy,params.window.zw,params.counts.y!=0u)'))
  assert.ok(trace.includes('layer+i32(params.layers.x)'))
  const upsample = selfShadowProgram(SELF_SHADOW_ENTRIES.upsample, 'none')
  assert.ok(upsample.includes('gid.xy+params.window.zw'))
  assert.ok(upsample.includes('layer+i32(params.layers.x)'))
  assert.ok(!selfShadowProgram(SELF_SHADOW_ENTRIES.downsample, 'none').includes('let id=gid;'))
  // Every kernel stops at the window's far end, so that a group that overshoots it writes nothing.
  assert.ok(upsample.includes('any(id.xy>=params.ends.zw)'))
  assert.ok(
    selfShadowProgram(SELF_SHADOW_ENTRIES.blur, 'none').includes('any(id.xy>=params.ends.xy)'),
  )
  assert.ok(trace.includes('any(id>=params.ends.xy)') && trace.includes('any(id>=params.ends.zw)'))
})

test('the point of a pixel is found only for a pixel that traces', () => {
  const trace = selfShadowProgram(SELF_SHADOW_ENTRIES.trace, 'none')
  assert.ok(trace.indexOf('if(inputs.ok){') < trace.indexOf('let P=worldAt('))
})
