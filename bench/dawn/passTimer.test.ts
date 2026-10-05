import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unionOf } from './passTimer.ts';

test('the union of pass spans counts an overlap once and a gap not at all', () => {
  assert.equal(unionOf([]), 0);
  assert.equal(
    unionOf([
      [0, 2],
      [1, 3],
      [5, 6],
    ]),
    4,
  );
  assert.equal(
    unionOf([
      [4, 5],
      [0, 10],
    ]),
    10,
  );
});
