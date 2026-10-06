// #1369: a pixel's resolve issues a bounded number of fetches per display pixel, its own identifier
// read once. The 3×3 depths come in four gathers and the geometry history's 2×2 in two
// (`geometryHistoryWgsl.ts`); a still upscaled pixel samples its share target once; a frame whose
// blends wrote no reactive value reads none (`resolve.ts`, `unreactive`). An upscaled pixel reads its
// 2×2 ring again after the 3×3, and a still one its 3×3 again for the still weights
// (`upscaleWgsl.ts`): texels the 3×3 just read, no new one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countTaaFetches } from './taaFetchCount.ts';

test('the resolve issues 23 fetches a moving pixel natively, 27 upscaled; 17 and 31 still', () => {
  const fragment = countTaaFetches;
  // A pixel that kept its placement; the uncovered one reads no history to clamp, so fewer.
  for (const [scale, kept, uncovered] of [
    [1, 23, 16],
    [0.5, 26.97265625, 20],
  ]) {
    assert.deepEqual(fragment(scale, false), { fetches: kept, ids: 1 });
    assert.deepEqual(fragment(scale, true), { fetches: uncovered, ids: 1 });
  }
  assert.deepEqual(fragment(1, false, false, false), { fetches: 17, ids: 1 });
  assert.deepEqual(fragment(0.5, false, false, false), { fetches: 31, ids: 1 });
  // The as-is resolve adds its 3×3 flags and one share read, still or moving.
  assert.deepEqual(fragment(0.5, false, true, false), { fetches: 40, ids: 1 });
  assert.deepEqual(fragment(1, false, true), { fetches: 32, ids: 1 });
  // A reactive value is one fetch more.
  assert.deepEqual(fragment(1, false, false, true, true), { fetches: 24, ids: 1 });
});
