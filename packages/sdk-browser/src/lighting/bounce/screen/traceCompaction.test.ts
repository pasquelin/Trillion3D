// The rays the screen left are listed for the scene stage in the order of the threads' lanes, as the reference's wave-operations compaction does.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { traceScreenShader } from './traceWgsl.ts'

test('the screen stage ranks the rays it lists by the subgroup prefix, or by a scan of the workgroup where the device has no subgroups', () => {
  const native = traceScreenShader(8, [4, 4], 'none', true, 'native')
  assertProgramAssembles(native, 'traceScreen', 'traceScreen native')
  assert.match(native, /enable subgroups;/)
  assert.match(native, /subgroupExclusiveAdd\(flag\)/)
  assert.match(native, /let slot=spCompactRank\(wants,lane\);/)
  const polyfill = traceScreenShader(8, [4, 4], 'none', true, 'polyfill')
  assertProgramAssembles(polyfill, 'traceScreen', 'traceScreen polyfill')
  assert.doesNotMatch(polyfill, /enable subgroups;/)
  assert.match(polyfill, /var<workgroup> compactScan:array<u32,SP_TRACE\*SP_TRACE>;/)
})

test('the list takes the group once, at the count the ranking left', () => {
  for (const compaction of ['native', 'polyfill'] as const) {
    const code = traceScreenShader(4, [4, 4], 'none', true, compaction)
    assert.match(code, /sceneBase=sceneRaysAppend\(spCompactTotal\(\),/)
    assert.doesNotMatch(code, /atomicAdd\(&sceneCount/)
  }
})
