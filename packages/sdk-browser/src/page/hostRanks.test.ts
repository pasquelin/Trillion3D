// Marking a list skips a record repeated next to itself — the placements of one primitive, rank
// after rank. Oracle: the same list marked one record at a time through `markRank`, the delta's own
// entry — entered, exited and held, in their order, image after image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostRankDelta } from './hostRanks.ts';
import { random } from './cut/cutRuleChecks.fixture.ts';

const URLS = Array.from({ length: 40 }, (_, rank) => `r${rank}`);

/** The delta's three lists, read whole. */
function listed(delta: ReturnType<ReturnType<typeof createHostRankDelta>['finish']>) {
  return {
    entered: [...delta.entered.subarray(0, delta.enteredCount)],
    exited: [...delta.exited.subarray(0, delta.exitedCount)],
    held: [...delta.held.subarray(0, delta.heldCount)],
  };
}

test('a list marked with its repeated records skipped leaves the deltas marked one by one', () => {
  const next = random(1235);
  // Records shared by runs of placements, some without a rank, some past the table.
  const records = Array.from({ length: 30 }, (_, i) => ({
    requestIndex: i % 7 === 3 ? undefined : i % 11 === 5 ? 99 : Math.floor(next() * URLS.length),
  }));
  const marked = createHostRankDelta(URLS.length, URLS),
    oneByOne = createHostRankDelta(URLS.length, URLS);
  for (let image = 0; image < 60; image++) {
    const list = Array.from({ length: Math.floor(next() * 50) }, () => records[0]);
    for (let i = 0, rec = records[0]; i < list.length; i++) {
      if (next() < 0.3) rec = records[Math.floor(next() * records.length)];
      list[i] = rec;
    }
    marked.begin();
    oneByOne.begin();
    marked.mark(list);
    for (const rec of list) if (rec.requestIndex !== undefined) oneByOne.markRank(rec.requestIndex);
    assert.deepEqual(listed(marked.finish()), listed(oneByOne.finish()), `image ${image}`);
  }
});
