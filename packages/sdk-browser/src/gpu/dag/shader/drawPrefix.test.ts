// `dagDrawPrefix` gave each block of drawn pages its offset with its own serial walk over the lane
// totals. It now reuses the engine's lane scan (`../../core/laneScanWgsl.ts`), whose runs and
// scan `../../draw/prefixEquivalence.test.ts` proves equal to the serial prefix. This file pins the
// shipped kernel to that shared scan and checks the scan on this kernel's shape: one slot, block
// counts below, at and past the 64 lanes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './shader.ts'
import { LANE_SCAN_WGSL } from '../../core/laneScanWgsl.ts'
import {
  prefixScan,
  prefixSerial,
} from '../../../../../../bench/oracles/browser/gpuDrawPrefixOracle.ts'

const prefixKernel = () => {
  const start = DAG_SELECTION_SHADER.indexOf('fn dagDrawPrefix')
  const end = DAG_SELECTION_SHADER.indexOf('fn dagDrawScatter')
  assert.ok(start >= 0 && end > start, 'the prefix kernel is present, before the scatter')
  return DAG_SELECTION_SHADER.slice(start, end)
}

test('the drawable-page prefix scans the block totals with the shared lane scan', () => {
  assert.equal(DAG_SELECTION_SHADER.split(LANE_SCAN_WGSL.text).length, 2, 'the lane scan, once')
  const kernel = prefixKernel()
  assert.match(kernel, /laneRun\(lane,count\)/, 'each lane owns a run of blocks')
  assert.match(kernel, /laneScan\(lane,total\)-total/, 'an exclusive prefix per run')
  assert.doesNotMatch(kernel, /laneTotals|for\(var l=0u;l<lane;/, 'no serial walk over the lanes')
})

test('one slot of blocks: the lane runs and scan give the serial offsets and total', () => {
  let seed = 981
  const rand = (bound: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % bound) as number
  for (const blocks of [0, 1, 63, 64, 65, 200, 4097]) {
    const counts = Uint32Array.from({ length: blocks }, () => rand(65))
    const serial = prefixSerial(false, new Uint32Array([1]), counts, blocks, 1)
    const scan = prefixScan(false, new Uint32Array([1]), counts, blocks, 1)
    assert.deepEqual([...scan.offsets], [...serial.offsets], `offsets, ${blocks} blocks`)
    assert.equal(scan.totals[0], serial.totals[0], `list total, ${blocks} blocks`)
  }
})
