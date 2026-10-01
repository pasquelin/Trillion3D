// #1369: a moving pixel's resolve reads a bounded number of texels per display pixel, its own
// identifier once at the display's size; an uncovered pixel adds its 3×3's identifiers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { countTaaFetches } from './taaFetchCount.ts';

test('the moving resolve reads 18 texels a pixel natively, 27 upscaled, one or two identifiers', () => {
  assert.deepEqual(countTaaFetches(1, false), { fetches: 18, ids: 1 });
  assert.deepEqual(countTaaFetches(0.5, false), { fetches: 27, ids: 2 });
  assert.deepEqual(countTaaFetches(1, true), { fetches: 27, ids: 10 });
});
