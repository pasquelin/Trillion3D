// `dagDrawPrefix` gave each block of drawn pages its offset with its own serial walk over the lane
// totals. It now reuses the engine's lane scan (`../../core/laneScanWgsl.ts`, #981), whose runs and
// scan `../../draw/prefixEquivalence.test.ts` proves equal to the serial prefix. This file pins the
// shipped kernel to that shared scan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAG_SELECTION_SHADER } from './shader.ts';
import { LANE_SCAN_WGSL } from '../../core/laneScanWgsl.ts';

const prefixKernel = () => {
  const start = DAG_SELECTION_SHADER.indexOf('fn dagDrawPrefix');
  const end = DAG_SELECTION_SHADER.indexOf('fn dagDrawScatter');
  assert.ok(start >= 0 && end > start, 'the prefix kernel is present, before the scatter');
  return DAG_SELECTION_SHADER.slice(start, end);
};

test('the drawable-page prefix scans the block totals with the shared lane scan', () => {
  assert.equal(DAG_SELECTION_SHADER.split(LANE_SCAN_WGSL).length, 2, 'the lane scan, once');
  const kernel = prefixKernel();
  assert.match(kernel, /let run=laneRun\(lane,count\);/, 'each lane owns a run of blocks');
  assert.match(kernel, /var cursor=laneScan\(lane,total\)-total;/, 'an exclusive prefix per run');
  assert.doesNotMatch(kernel, /laneTotals|for\(var l=0u;l<lane;/, 'no serial walk over the lanes');
});
