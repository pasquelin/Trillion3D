// A list read off the ranks it claims in the last list applied (`claimedDifference.ts`) publishes
// what the hashed difference publishes — every list, record, order, membership and byte — whatever
// the claims, as long as each page's occurrences carry one: the GPU's exact ones, none, ranks of
// another list, noise. The claims only decide how many pages the catalogue is asked for: with the
// GPU's, the pages the list held did not hold, and a repeat of the list before at most once more —
// never the tail of a list behind a skipped id.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import type { PageRec } from '../../page/selection/selection.ts';
import { SELECTION_NONE } from '../../gpu/core/selection.ts';
import { createCutDelta } from './delta.ts';
import { differenceOf } from '../../gpu/dag/difference.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { countedCatalogue, published } from './readbackChain.fixture.ts';

const PAGES = 300;
/** Records for the first `PAGES - 20` ids: the last twenty have none. */
const RECORDS = PAGES - 20;

/** A cut of distinct pages in a random order, now and then with repeats or unknown pages. */
function randomCut(next: () => number, from: number[]) {
  const kept = from.filter(() => next() < 0.9);
  const added = Array.from({ length: Math.floor(next() * 40) }, () => Math.floor(next() * PAGES));
  const cut = [...new Set([...kept, ...added])];
  if (next() < 0.5) cut.sort((a, b) => a - b);
  else
    for (let i = cut.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [cut[i], cut[j]] = [cut[j], cut[i]];
    }
  if (next() < 0.3) cut.splice(Math.floor(next() * cut.length), 0, ...cut.slice(0, 3));
  return next() < 0.1 ? from.slice() : cut;
}

/** The same lists into a claimed delta and a hashed one, the claims made by `claims` from the list
 *  and the one before as it was published; both publish the same. Returns the lookups the claimed
 *  one took, and the bound the GPU's claims keep them under. */
function follow(claims: (list: number[], before: number[], next: () => number) => Uint32Array) {
  const next = random(831);
  const { records, counted } = countedCatalogue(RECORDS);
  const hashedPages: PageRec[] = [],
    claimedPages: PageRec[] = [];
  const hashed = createCutDelta(records, hashedPages),
    claimed = createCutDelta(counted, claimedPages);
  let before: number[] = [],
    bound = 0;
  for (let step = 0; step < 300; step++) {
    const list = randomCut(next, before),
      repeated = new Set(before.filter((id, i) => before.indexOf(id) !== i));
    const fresh = list.filter((id) => !hashed.has(id) || repeated.has(id)).length;
    hashed.apply(list);
    claimed.apply(list, undefined, claims(list, before, next));
    const a = published(claimed, claimedPages, PAGES),
      b = published(hashed, hashedPages, PAGES);
    assert.deepEqual(a, b, `${step}`);
    if (hashed.changed) bound += fresh;
    before = list;
  }
  return { lookups: counted.lookups, bound };
}

test("the GPU's claims publish the hashed difference and look up only what was not held", () => {
  const { lookups, bound } = follow((list, before) => differenceOf(list, before));
  assert.ok(lookups <= bound, `${lookups} lookups, bound ${bound}`);
});

test('any claims publish the hashed difference: none, another list, noise', () => {
  const none = (list: number[]) => new Uint32Array(list.length).fill(SELECTION_NONE);
  let older: number[] = [];
  const stale = (list: number[], before: number[]) => {
    const claims = differenceOf(list, older);
    older = before;
    return claims;
  };
  // A rank or none drawn once a page: its occurrences agree.
  const noise = (list: number[], _: number[], next: () => number) => {
    const drawn = new Map<number, number>();
    for (const id of list)
      if (!drawn.has(id)) drawn.set(id, next() < 0.5 ? Math.floor(next() * 60) : SELECTION_NONE);
    return Uint32Array.from(list, (id) => drawn.get(id)!);
  };
  for (const claims of [none, stale, noise]) follow(claims);
});

test('a skipped id early in the list leaves the claims behind it believed', () => {
  // Raw [70, 70, 299, 1..40]: a repeat and an id without a record skipped, every later rank
  // shifted.
  const { records, counted } = countedCatalogue(RECORDS);
  const delta = createCutDelta(counted, []),
    first = [70, 70, PAGES - 1, ...Array.from({ length: 40 }, (_, i) => i + 1)];
  delta.apply(first, undefined, differenceOf(first, []));
  const list = [...first.slice(3), 50];
  counted.lookups = 0;
  delta.apply(list, undefined, differenceOf(list, first));
  assert.equal(counted.lookups, 1, 'the entry alone');
  assert.equal(delta.count, 41);
  assert.equal(records.length, RECORDS);
});

test('a held page the claims missed is found by its mark, and stays', () => {
  const { records } = countedCatalogue(RECORDS);
  const delta = createCutDelta(records, []);
  delta.apply([1, 2, 3, 4]);
  // Page 3 is held at rank 2, but no claim names it: the GPU lost sight of it in between.
  delta.apply([4, 3, 9], undefined, Uint32Array.from([3, SELECTION_NONE, SELECTION_NONE]));
  assert.deepEqual([...delta.entered.subarray(0, delta.enteredCount)], [9]);
  assert.deepEqual([...delta.exited.subarray(0, delta.exitedCount)], [1, 2]);
  assert.equal(delta.has(3) && delta.has(4) && delta.has(9) && !delta.has(1), true);
});

test('the records stay a packed array, whatever the list skips or claims', () => {
  v8.setFlagsFromString('--allow-natives-syntax');
  const holey = new Function('list', 'return %HasHoleyElements(list)') as (
    list: unknown,
  ) => boolean;
  const { records } = countedCatalogue(RECORDS);
  // An entry before a held page at the end: rank 4 carries a held record while rank 3 waits.
  const pages: PageRec[] = [];
  const delta = createCutDelta(records, pages);
  delta.apply([1, 2, 3], undefined, differenceOf([1, 2, 3], []));
  delta.apply([1, 2, 9, 8, 3], undefined, differenceOf([1, 2, 9, 8, 3], [1, 2, 3]));
  assert.deepEqual([...delta.entered.subarray(0, delta.enteredCount)], [9, 8]);
  assert.equal(holey(pages), false);
  // A first list that starts with an id without a record and repeats one.
  const fresh: PageRec[] = [];
  const first = createCutDelta(records, fresh),
    ids = [PAGES - 1, 5, 6, 5, PAGES - 2, 7];
  first.apply(ids, undefined, differenceOf(ids, []));
  assert.deepEqual(
    fresh.map((page) => (page as unknown as { id: number }).id),
    [5, 6, 7],
  );
  assert.equal(holey(fresh), false);
});
