// #1363: the pair cull's admission (`admitShadowPairs`), run from its shipped WGSL: one workgroup
// scans the regions' counts over its lanes, a run of regions each (`LANE_SCAN_WGSL`), gives each
// region its place in the list and admits the longest prefix of whole regions the list holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runShadowPairStep } from './freshRun.fixture.ts';
import {
  FRESH_ARG,
  FRESH_PARAMS,
  FRESH_SHORT,
  freshArgWords,
  freshRegionPairs,
} from './freshLayout.ts';

test('the admission gives each region its place over the lanes and admits the longest whole prefix', () => {
  // A hundred and fifty regions, runs of three a lane, counting 0 to 4 pairs each.
  const pages = 150,
    capacity = 200,
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(pages)),
    counts = Array.from({ length: pages }, (_, k) => k % 5);
  params.set([pages, 4, 1, 0, 0, 0, capacity]);
  args[FRESH_ARG.regions] = pages;
  args.set(counts, freshRegionPairs(pages, 0));
  const bytes = (a: Uint32Array) => new Uint8Array(a.buffer);
  runShadowPairStep(
    'admitShadowPairs',
    ...[new Uint32Array(4), params, new Uint32Array(20)].map(bytes),
    ...[new Uint32Array(2), args, new Uint32Array(1)].map(bytes),
  );
  let at = 0,
    kept = -1;
  counts.forEach((count, k) => {
    const fits = at + count <= capacity;
    if (!fits && kept < 0) kept = at;
    assert.equal(
      args[freshRegionPairs(pages, k)],
      fits && kept < 0 ? at : FRESH_SHORT,
      `region ${k}`,
    );
    at += count;
  });
  assert.equal(args[FRESH_ARG.pairs], kept, 'the pairs of the admitted prefix');
  assert.equal(args[FRESH_ARG.need], at, 'the pairs every region counted');
});
