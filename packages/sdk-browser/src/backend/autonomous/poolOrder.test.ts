import test from 'node:test';
import assert from 'node:assert/strict';
import { createResidentOrder } from './poolOrder.ts';
import type { PageRec } from '../../page/selection/selection.ts';

// #839: a coarser page the image let go of is held over one `keep`, never for as long as a finer
// page leaves each image — a moving view would otherwise hold every coarse page it passed.
test('a view that lets go of a finer page every image still releases the coarse ones it passed', () => {
  const recs = new Map<string, PageRec>();
  const rec = (url: string, level: number) => {
    if (!recs.has(url)) recs.set(url, { url, level } as PageRec);
    return recs.get(url)!;
  };
  const order = createResidentOrder({
    state: { allocationBytes: 0 },
    drop: () => {},
    limit: () => Infinity,
    floorBytes: () => 0,
    pageBytes: () => 1,
    parentsOf: () => [],
  });
  let most = 0;
  for (let t = 0; t < 200; t++) {
    const view = [0, 1, 2, 3, 4].map((i) => rec(`f${t + i}`, 0));
    view.push(rec(`c${Math.floor(t / 5)}`, 2));
    // A finer fallback drawn but not asked for: it leaves at every trim.
    order.follow(view, [...view, rec(`g${t}`, 1)]);
    order.trim();
    most = Math.max(most, order.keyCount);
  }
  assert.ok(most <= 10, `${most} keys for a view of 7 pages`);
});
