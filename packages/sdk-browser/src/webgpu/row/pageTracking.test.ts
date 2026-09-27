// A trace sample taken from the records themselves (`traceRecs`) is the sample of their address
// list (`traceSet` over `urlsOf`), without building that list: same count, same probe, same page
// ids, and the same revision history, call after call, on random lists and on the edge sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from './pageTracking.ts';
import { urlsOf } from '../pages/helpers.ts';
import type { PageRec } from '../../page/selection/selection.ts';

/** A deterministic generator: the same inputs on every run. */
function random(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** A catalogue where one page in three is addressed by its geometry page, shared by pairs. */
function catalogue(size: number) {
  return Array.from({ length: size }, (_, index) => {
    const page = { url: `index-${index}.bin` } as PageRec;
    if (index % 3 === 0) page.geometryPage = { url: `geometry-${index >> 1}.bin` } as never;
    return page;
  });
}

test('traceRecs publishes what traceSet publishes from the addresses, history included', () => {
  const next = random(919);
  const pages = catalogue(120);
  const bySet = createWebgpuPageTracking(pages),
    byRecs = createWebgpuPageTracking(pages);
  const names = ['frame.loaded', 'frame.wanted', 'drawn'];
  let previous: PageRec[] = [];
  // Sizes around the sample bound (16), empty lists, the whole catalogue, repeated and one-page
  // edits of the previous list: the cases where the revision holds or moves.
  const sizes = [0, 1, 15, 16, 17, 32, 120];
  for (let step = 0; step < 2000; step++) {
    const roll = next();
    let list: PageRec[];
    if (roll < 0.25) list = previous;
    else if (roll < 0.45 && previous.length) {
      list = [...previous];
      list[Math.floor(next() * list.length)] = pages[Math.floor(next() * pages.length)];
    } else {
      const size = roll < 0.6 ? sizes[step % sizes.length] : Math.floor(next() * 60);
      list = Array.from({ length: size }, () => pages[Math.floor(next() * pages.length)]);
    }
    const name = names[Math.floor(next() * names.length)];
    assert.deepEqual(
      byRecs.traceRecs(name, list),
      bySet.traceSet(name, urlsOf(list)),
      `step ${step}`,
    );
    previous = list;
  }
  assert.deepEqual(byRecs.traceSets, bySet.traceSets);
});

test('an empty list and the whole catalogue sample alike from records and from addresses', () => {
  const pages = catalogue(40);
  const bySet = createWebgpuPageTracking(pages),
    byRecs = createWebgpuPageTracking(pages);
  for (const list of [[], pages, pages, [], pages.slice(0, 16), pages.slice(0, 17)])
    assert.deepEqual(byRecs.traceRecs('set', list), bySet.traceSet('set', urlsOf(list)));
});
