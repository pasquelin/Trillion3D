// A frame draws its shadow pages in as many batches as they take (#489), each batch a light cut.
// Every batch's requests must be read back, whatever the batch count: the cuts append to one list
// the frame copies once (`VIEW_APPEND`), so no batch's coarse view is redrawn for want of a report
// slot, and its missing casters are asked for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightCutFrame } from './lightCutFrame.fixture.ts';
import { VIEW_APPEND } from './shader/pagesWgsl.ts';

test("a frame of many batches reads back every batch's requests in one copy", async () => {
  const { cut, frame } = lightCutFrame();
  const pages = [0, 1, 2, 3, 4, 5, 6, 7];
  const { flags, copies } = await frame(pages, new Set());
  assert.equal(flags[0] & VIEW_APPEND, 0, 'the first cut starts the list');
  assert.ok(
    flags.slice(1).every((word) => (word & VIEW_APPEND) !== 0),
    'every later cut appends to it',
  );
  assert.equal(copies, 1, 'one copy for the frame');
  assert.deepEqual(
    cut.reports.takeRequests()?.sort((a, b) => a - b),
    pages,
    "every batch's missing caster is asked for",
  );
  const now: number[] = [];
  cut.redraws.takeRedraw((page) => now.push(page));
  assert.deepEqual(now, [], 'no coarse view is redrawn for want of a report slot');
});

test('a sweep of many batches a frame converges to full detail', async () => {
  const { cut, frame } = lightCutFrame();
  const resident = new Set<number>();
  let drawn = Array.from({ length: 12 }, (_, page) => page);
  for (let step = 0; step < 4 && drawn.length; step++) {
    await frame(drawn, resident);
    const asked = cut.reports.takeRequests() ?? [];
    for (const page of asked) resident.add(page);
    if (asked.length) cut.redraws.residencyChanged();
    cut.redraws.rest();
    const again: number[] = [];
    cut.redraws.takeRedraw((page) => again.push(page));
    drawn = again;
  }
  assert.equal(resident.size, 12, 'every caster was asked for and arrived');
  assert.deepEqual(drawn, [], 'every page is drawn at full detail, nothing left to redraw');
});
