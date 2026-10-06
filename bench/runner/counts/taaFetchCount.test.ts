// A pixel's resolve issues a bounded number of fetches per display pixel. The 3×3 depths come
// in four gathers and their identifiers in four more, the nearest's identifier among them; the
// geometry history's 2×2 in two (`geometryHistoryWgsl.ts`); the history is read beside the
// geometry test, an uncovered pixel's as a kept one's, then dropped (`historyWgsl.ts`); a still
// upscaled pixel samples its share target once; a frame whose blends wrote no reactive value reads
// none (`resolve.ts`, `unreactive`). An upscaled pixel reads its 2×2 ring again after the 3×3, and a
// still one its 3×3 again for the still weights (`upscaleWgsl.ts`): texels the 3×3 just read, no
// new one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countTaaFetches } from './taaFetchCount.ts'

test('the resolve issues 26 fetches a moving pixel natively, 30 upscaled; 20 and 34 still', () => {
  const fragment = countTaaFetches
  // A pixel that kept its placement, and an uncovered one, which reads as much and keeps none of it;
  // the identifiers of its 3×3, sixteen texels in four gathers.
  for (const [scale, fetches] of [
    [1, 26],
    [0.5, 30],
  ]) {
    assert.deepEqual(fragment(scale, false), { fetches, ids: 16 })
    assert.deepEqual(fragment(scale, true), { fetches, ids: 16 })
  }
  assert.deepEqual(fragment(1, false, false, false), { fetches: 20, ids: 16 })
  assert.deepEqual(fragment(0.5, false, false, false), { fetches: 34, ids: 16 })
  // The as-is resolve adds its 3×3 flags and one share read, still or moving.
  assert.deepEqual(fragment(0.5, false, true, false), { fetches: 43, ids: 16 })
  assert.deepEqual(fragment(1, false, true), { fetches: 35, ids: 16 })
  // A reactive value is one fetch more.
  assert.deepEqual(fragment(1, false, false, true, true), { fetches: 27, ids: 16 })
})
