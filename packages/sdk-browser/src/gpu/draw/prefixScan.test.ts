import test from 'node:test'
import assert from 'node:assert/strict'
import { drawShader } from './shader.ts'
import { slotCount } from './draw.ts'
import { LANE_SCAN_WGSL } from '../core/laneScanWgsl.ts'

// The indirect-draw prefix walked every group of a slot on one thread (D3: one thread per slot).
// It now walks the slots in order with the sixty-four threads of the workgroup, each totalling a
// run of groups, the run totals scanned in workgroup memory (#923). This file pins the shipped
// kernel to the shape the oracle `prefixScan` describes; `prefixEquivalence.test.ts` proves that
// oracle equal to the serial walk.

const prefixKernel = (shader: string) => {
  const start = shader.indexOf('fn prefixGroups')
  const end = shader.indexOf('fn scatterGroups')
  assert.ok(start >= 0 && end > start, 'the prefix kernel is present, before the scatter')
  return shader.slice(start, end)
}

test('the shipped prefix kernel scans each slot over the 64 threads in workgroup memory', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k)
    assert.ok(shader.includes(LANE_SCAN_WGSL), 'the shared lane scan')
    assert.match(
      shader,
      /@compute @workgroup_size\(64\)\s*fn prefixGroups\(@builtin\(local_invocation_index\) lane:u32\)/,
    )
    const kernel = prefixKernel(shader)
    assert.match(kernel, new RegExp(`for\\(var slot=0u;slot<${slotCount(k)}u;slot\\+\\+\\)`))
    assert.match(kernel, /let span=laneRun\(lane,uni\.groupCount\);/, 'each lane owns a run')
    assert.match(kernel, /if\(slotUsed\[slot\]==0u\)\{/, 'an unused slot skips the scan')
    assert.match(kernel, /let inclusive=laneScan\(lane,sum\);/, 'a scan over the lanes')
    assert.match(kernel, /var cursor=start\+inclusive-sum;/, 'an exclusive prefix per run')
    assert.doesNotMatch(kernel, /for\(var group=0u;group<uni\.groupCount;group\+\+\)/)
  }
})
