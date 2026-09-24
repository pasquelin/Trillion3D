import test from 'node:test';
import assert from 'node:assert/strict';
import { createLightCutRows } from './lightCutRows.ts';
import { VIEW_STATE_FRESH } from './shader/viewsWgsl.ts';

// A sun level drawn at rank 0, then at rank 1 behind a finer level: it keeps its own row, and the
// finer level, new, takes a fresh one — never the threshold the other left.
test("a light view keeps its own state row whatever its rank in the frame's cut", () => {
  const rows = createLightCutRows(4);
  const frame = (ids: number[]) => {
    rows.assign(ids.length, (v) => ids[v]);
    return Array.from(rows.words.subarray(0, ids.length));
  };
  const fresh = (row: number) => (row | VIEW_STATE_FRESH) >>> 0;
  const level3 = 3,
    level1 = 1;
  assert.deepEqual(frame([level3]), [fresh(0)]);
  assert.deepEqual(frame([level1, level3]), [fresh(1), 0]);
  assert.deepEqual(frame([level3, level1]), [0, 1], 'both carry their own over');
  assert.deepEqual(frame([7, 8, 9]), [fresh(2), fresh(3), fresh(0)], 'least recently drawn first');
  assert.deepEqual(frame([level1]), [1], 'a view not evicted finds its row again');
});
