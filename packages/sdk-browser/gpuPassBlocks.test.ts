import test from 'node:test';
import assert from 'node:assert/strict';
import type { GpuPassTimings } from '../sdk-core/index.ts';
import { gpuPassBlockOf, gpuPassBlockTotals } from './gpuPassBlocks.ts';

const sample = (
  passes: Array<[string, number | null]>,
  extra: Partial<GpuPassTimings> = {},
): GpuPassTimings => ({
  frame: 7,
  totalMs: null,
  truncated: false,
  passes: passes.map(([name, gpuMs]) => ({ name, gpuMs })),
  ...extra,
});

test('each pass falls in the block its label names, and an unknown one stays outside', () => {
  assert.equal(gpuPassBlockOf('WG DAG selection'), 'visibility');
  assert.equal(gpuPassBlockOf('WG visibility primary'), 'visibility');
  assert.equal(gpuPassBlockOf('WG HiZ pyramid'), 'visibility');
  assert.equal(gpuPassBlockOf('WG material surfaces v1'), 'materials');
  assert.equal(gpuPassBlockOf('WG empty surfaces'), 'materials');
  assert.equal(gpuPassBlockOf('WG deferred lighting'), 'other');
  assert.equal(gpuPassBlockOf('WG shadow atlas v1'), 'other');
  assert.equal(gpuPassBlockOf('WG opaque fallback'), 'other');
  assert.equal(gpuPassBlockOf('WG pass invented tomorrow'), 'other');
});

test("a block's durations add up, and the three sum to that of the passes", () => {
  const totals = gpuPassBlockTotals(
    sample([
      ['WG clear', 0.066],
      ['WG DAG selection', 0.406],
      ['WG visibility primary', 1.148],
      ['WG HiZ pyramid', 0.099],
      ['WG empty surfaces', 0.217],
      ['WG material surfaces v1', 2.084],
      ['WG deferred lighting', 1.5],
    ]),
  );
  assert.equal(totals.visibilityMs?.toFixed(3), '1.719');
  assert.equal(totals.materialsMs?.toFixed(3), '2.301');
  assert.equal(totals.otherMs, 1.5);
  assert.equal((totals.visibilityMs! + totals.materialsMs! + totals.otherMs!).toFixed(3), '5.520');
});

test('a pass without a duration voids ITS block, never the others', () => {
  const totals = gpuPassBlockTotals(
    sample([
      ['WG DAG selection', null],
      ['WG visibility primary', 1.148],
      ['WG material surfaces v1', 2.084],
    ]),
  );
  assert.equal(totals.visibilityMs, null, 'a partial sum would pass for a measurement');
  assert.equal(totals.materialsMs, 2.084);
  assert.equal(totals.otherMs, null, 'no pass: no block, and above all not a zero');
});

test('order changes nothing: a pass without a duration voids its block even when announced last', () => {
  const totals = gpuPassBlockTotals(
    sample([
      ['WG visibility primary', 1.148],
      ['WG DAG selection', null],
    ]),
  );
  assert.equal(totals.visibilityMs, null);
});

test('a truncated or missing sample yields no block', () => {
  const truncated = gpuPassBlockTotals(
    sample([['WG visibility primary', 1.148]], { truncated: true }),
  );
  assert.deepEqual(truncated, { visibilityMs: null, materialsMs: null, otherMs: null });
  assert.deepEqual(gpuPassBlockTotals(null), {
    visibilityMs: null,
    materialsMs: null,
    otherMs: null,
  });
  assert.deepEqual(gpuPassBlockTotals(undefined), {
    visibilityMs: null,
    materialsMs: null,
    otherMs: null,
  });
});
