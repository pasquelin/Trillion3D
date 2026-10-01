// #1279: a device that overlaps passes reports each one's whole span; the own share counts an
// overlap once, on the pass begun first, so the shares add up to the image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTimestamps } from './sample.ts';

const ms = (value: number) => BigInt(value * 1e6);

test('overlapping passes keep their spans and get each its own share of the image', () => {
  const names = ['water composite', 'temporal antialiasing', 'composition', 'unmeasured'];
  const entries = names.map((name, i) => ({ slot: i * 2, name, part: 0 }));
  // 1 → 46, 11 → 51 and 13 → 53 ms: three spans that overlap; the last pair is invalid.
  const values = new BigUint64Array([ms(1), ms(46), ms(11), ms(51), ms(13), ms(53), 0n, ms(9)]);
  const { sample } = summarizeTimestamps(entries, values, false);
  assert.deepEqual(
    sample.passes.map((pass) => [pass.gpuMs, 'ownMs' in pass ? pass.ownMs : undefined]),
    [
      [45, 45],
      [40, 5],
      [40, 2],
      [null, undefined],
    ],
  );
  // Listed out of their beginning order, the share still goes to the pass begun first.
  const swapped = new BigUint64Array([ms(11), ms(51), ms(1), ms(46)]);
  const two = summarizeTimestamps(entries.slice(0, 2), swapped, false).sample.passes;
  assert.deepEqual(
    two.map((pass) => ('ownMs' in pass ? pass.ownMs : undefined)),
    [5, 45],
  );
});
