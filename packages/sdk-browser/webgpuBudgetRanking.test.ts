import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from './pageSelection.ts';
import { createBudgetRanking } from './webgpuBudgetRanking.ts';

const keyOf = (page: PageRec) => page.keyIndex as number;
const rec = (key: number, level: number | undefined, tag: string) =>
  ({ url: tag, keyIndex: key, level }) as unknown as PageRec;

/** The whole-set version: filter the cover out, keep the first placement of each page — the budget
 *  counts slots, and one page is one slot — stable sort coarsest first, then cut to the budget.
 *  Order included, not just membership. */
function reference(cut: readonly PageRec[], cover: Uint8Array, room: number) {
  const pages: PageRec[] = [],
    seen = new Set<number>();
  for (const page of cut) {
    const key = keyOf(page);
    if (cover[key] || seen.has(key)) continue;
    seen.add(key);
    pages.push(page);
  }
  pages.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  pages.length = Math.min(pages.length, Math.max(0, room));
  return { keys: pages.map(keyOf), pages };
}

/** Pages the budget weighs: the cut's distinct keys, the cover excluded. */
const weighed = (cut: readonly PageRec[], cover: Uint8Array) =>
  new Set(cut.filter((page) => !cover[keyOf(page)]).map(keyOf)).size;

const ranked = (ranking: ReturnType<typeof createBudgetRanking>) => ({
  keys: [...ranking.keys.subarray(0, ranking.length)],
  pages: ranking.ranked.slice(0, ranking.length),
});

/** A reproducible pseudo-random stream: the sweep below has to be the same on every run. */
function stream(seed: number) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

test('the counting rank is the stable comparison sort, order and records alike', () => {
  const next = stream(20260915);
  for (let trial = 0; trial < 200; trial++) {
    const keyCount = 1 + Math.floor(next() * 40);
    const cover = new Uint8Array(keyCount);
    for (let key = 0; key < keyCount; key++) cover[key] = next() < 0.2 ? 1 : 0;
    // A level belongs to the page, not to the placement: two placements of one cluster are the same
    // cluster, at the same level, in one cache slot.
    const levels = Array.from({ length: keyCount }, () =>
      next() < 0.1 ? undefined : Math.floor(next() * 13),
    );
    const opaque: PageRec[] = [],
      transparent: PageRec[] = [];
    const count = Math.floor(next() * 120);
    for (let i = 0; i < count; i++) {
      const key = Math.floor(next() * keyCount);
      const page = rec(key, levels[key], `p${i}`);
      (next() < 0.85 ? opaque : transparent).push(page);
    }
    const room = Math.floor(next() * (count + 3));
    const ranking = createBudgetRanking({ keyCount, bootstrapKey: cover, keyOf });
    for (const page of opaque) ranking.add(page);
    const cut = [...opaque, ...transparent];
    const records = ranking.rank(room, cut, transparent);
    assert.equal(records, weighed(cut, cover), `essai ${trial} : pages pesées`);
    if (records <= room) continue;
    assert.deepEqual(ranked(ranking), reference(cut, cover, room), `essai ${trial} : rang`);
  }
});

test('a placement that leaves is subtracted, and the rank follows the cut that remains', () => {
  const cover = new Uint8Array(6);
  cover[0] = 1;
  const cut = [
    rec(0, 3, 'cover'),
    rec(1, 0, 'fine-a'),
    rec(2, 2, 'coarse-a'),
    rec(3, 1, 'mid'),
    rec(2, 2, 'coarse-a-again'),
    rec(4, 2, 'coarse-b'),
  ];
  const ranking = createBudgetRanking({ keyCount: 6, bootstrapKey: cover, keyOf });
  for (const page of cut) ranking.add(page);
  // Four pages, not five placements: the two `coarse-a` records share one slot.
  assert.equal(ranking.rank(3, cut, []), 4);
  // Coarsest first, publication order inside a level, one entry per page.
  assert.deepEqual(ranked(ranking).keys, [2, 4, 3]);
  // The two coarse-a placements leave; what is left is mid then fine, and it now fits.
  ranking.remove(cut[2]);
  ranking.remove(cut[4]);
  const shorter = [cut[0], cut[1], cut[3], cut[5]];
  assert.equal(ranking.rank(3, shorter, []), 3);
  assert.equal(ranking.pageCount, 3);
  assert.equal(ranking.rank(2, shorter, []), 3);
  assert.deepEqual(ranked(ranking).keys, [4, 3]);
  ranking.clear();
  assert.equal(ranking.rank(1, [], []), 0);
});

test('a rank the queue already holds is recognised, a rank that differs is not', () => {
  const cover = new Uint8Array(4);
  const cut = [rec(0, 2, 'a'), rec(1, 1, 'b'), rec(2, 0, 'c')];
  const ranking = createBudgetRanking({ keyCount: 4, bootstrapKey: cover, keyOf });
  for (const page of cut) ranking.add(page);
  ranking.rank(2, cut, []);
  const list = Int32Array.from([0, 1]);
  assert.equal(ranking.matches(list, 2, [cut[0], cut[1]]), true);
  assert.equal(ranking.matches(list, 1, [cut[0]]), false, 'longueur différente');
  assert.equal(ranking.matches(Int32Array.from([1, 0]), 2, [cut[1], cut[0]]), false, 'ordre');
  assert.equal(
    ranking.matches(list, 2, [cut[0], rec(1, 1, 'autre')]),
    false,
    'même clé, autre enregistrement',
  );
});

test('levels beyond the first band grow the counters without disturbing the rank', () => {
  const cover = new Uint8Array(3);
  const cut = [rec(0, 0, 'zero'), rec(1, 40, 'haut'), rec(2, 9, 'milieu')];
  const ranking = createBudgetRanking({ keyCount: 3, bootstrapKey: cover, keyOf });
  for (const page of cut) ranking.add(page);
  ranking.rank(2, cut, []);
  assert.deepEqual(ranked(ranking), reference(cut, cover, 2));
});
