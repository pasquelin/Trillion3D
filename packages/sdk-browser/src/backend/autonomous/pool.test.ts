import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PAGE } from './pool.fixture.ts';

test('under its budget the pool walks nothing: an arrival only enters the order', () => {
  const f = fixture(10, { budgetBytes: 5 * PAGE });
  for (let i = 0; i < 5; i++) f.arrive(`p${i}`);
  f.pool.trim();
  assert.equal(f.rootReads(), 0);
  assert.deepEqual(f.dropped, []);
  assert.equal(f.pool.held.budgetBytes, 5 * PAGE);
  assert.equal(f.pool.held.slots, 5);
});

test('over its budget the pool sheds the pages it holds least recently used, never a held one', () => {
  const f = fixture(10, { budgetBytes: 3 * PAGE });
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.keep(['p0']);
  f.pool.trim();
  f.arrive('p3');
  // p0 is the oldest but asked for: p1 leaves in its place, and the page that just arrived stays.
  assert.deepEqual(f.dropped, ['p1']);
  assert.ok(f.state.allocationBytes <= 3 * PAGE);
  // Once no longer asked for, p0 is released at the next cut, and its last use was that image: p2,
  // unused since it arrived, leaves before it (#839: last use, not arrival).
  f.keep([]);
  f.pool.trim();
  f.arrive('p4');
  assert.deepEqual(f.dropped, ['p1', 'p2']);
  assert.deepEqual([...f.resident].sort(), ['p0', 'p3', 'p4']);
});

test('a page asked for holds its parents: the ancestor drawn in its place never leaves under it', () => {
  const f = fixture(10, { budgetBytes: PAGE, parents: { p1: ['p0'] } });
  f.arrive('p0');
  // p1 is asked for and missing: p0 stands in for it, drawn by the image.
  f.keep(['p1'], ['p0']);
  f.pool.trim();
  f.arrive('p2');
  // Just before the next cut, what the image drew is no longer protected as drawn: p0 stays as the
  // parent of a page asked for, and the page no image holds goes (#839).
  f.pool.trim();
  assert.deepEqual(f.dropped, ['p2']);
  assert.deepEqual([...f.resident], ['p0']);
});

test('a page accepted again is the most recent again', () => {
  const f = fixture(10, { budgetBytes: 2 * PAGE });
  f.arrive('p0');
  f.arrive('p1');
  f.arrive('p0');
  f.pool.trim();
  f.arrive('p2');
  assert.deepEqual(f.dropped, ['p1'], 'p0 was refreshed: p1 is the oldest');
});

test('when what is held fills the budget, arrivals stay and nothing is walked again', () => {
  const f = fixture(100, { budgetBytes: 2 * PAGE });
  f.keep(['p0', 'p1', 'p2']);
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.pool.trim();
  const reads = f.rootReads();
  // A burst of arrivals the cut has not asked for yet: none is evicted on arrival, and the floor
  // is not read again for each.
  for (let i = 3; i < 50; i++) f.arrive(`p${i}`);
  assert.deepEqual(f.dropped, [], 'a held page is never evicted, an arrival not on arrival');
  assert.equal(f.rootReads(), reads);
  // The next cut asks for a coarser cover: what it left goes, oldest first, down to the budget.
  f.keep(['p49']);
  assert.equal(f.pool.trim(), 48);
  assert.equal(f.state.allocationBytes, 2 * PAGE);
  assert.equal(f.rootReads(), reads + 1);
});

test('the root cover floor follows the cover as instances change it', () => {
  const f = fixture(10, { budgetBytes: 2 * PAGE, rootPages: 3 });
  // Two instances of a three-page cover.
  f.root(6 * PAGE);
  assert.equal(f.pool.held.clamp, 'root-cover');
  f.arrive('p0');
  f.pool.trim();
  assert.deepEqual(f.dropped, ['p0'], 'only what is above the cover leaves');
  // One instance removed halves the cover: the floor is read again, not left at 600 bytes.
  f.root(3 * PAGE);
  f.arrive('p1');
  f.arrive('p2');
  f.pool.trim();
  assert.deepEqual(f.dropped, ['p0', 'p1', 'p2']);
  assert.equal(f.state.allocationBytes, 3 * PAGE);
});

test('the page cap and the session ceiling bound the slots, as on WebGPU', () => {
  const capped = fixture(100, { budgetBytes: 50 * PAGE, maxResidentPages: 8 });
  assert.equal(capped.pool.held.slots, 8);
  assert.equal(capped.pool.held.clamp, 'page-cap');
  const f = fixture(100, { budgetBytes: 10 * PAGE });
  f.pool.resize(40 * PAGE);
  assert.equal(f.pool.held.slots, 10, 'no ceiling named: the starting budget is the ceiling');
  assert.equal(f.pool.held.clamp, 'ceiling');
});

test('a smaller budget mid-session evicts at once; an invalid one changes nothing', () => {
  const f = fixture(10);
  for (let i = 0; i < 6; i++) f.arrive(`p${i}`);
  assert.equal(f.pool.held.clamp, 'scene');
  f.keep(['p5']);
  f.pool.trim();
  assert.equal(f.pool.resize(2 * PAGE), 4);
  assert.deepEqual(f.dropped, ['p0', 'p1', 'p2', 'p3']);
  assert.equal(f.pool.held.slots, 2);
  assert.throws(() => f.pool.resize(0), /INVALID_GEOMETRY_POOL_BUDGET/);
  assert.equal(f.pool.held.budgetBytes, 2 * PAGE);
});

test('a page the streamer evicted leaves the order', () => {
  const f = fixture(10, { budgetBytes: 2 * PAGE });
  f.arrive('p0');
  f.arrive('p1');
  f.resident.delete('p0');
  f.state.allocationBytes -= PAGE;
  f.pool.left('p0');
  f.arrive('p2');
  f.pool.trim();
  f.arrive('p3');
  assert.deepEqual(f.dropped, ['p1']);
});

test('a page the host replaced leaves the order: it is held under the floor, never evicted', () => {
  const f = fixture(10, { budgetBytes: 2 * PAGE });
  f.arrive('p0');
  f.arrive('p1');
  f.pool.trim();
  // p0 is replaced: its bytes stay, and join what nothing may evict.
  f.pool.left('p0');
  f.root(0);
  f.arrive('p2');
  assert.deepEqual(f.dropped, ['p1'], 'the oldest evictable page, never the replaced one');
});

test('the bytes the pool holds are bounded as its slots are, by the page cap', () => {
  const f = fixture(100, { budgetBytes: 50 * PAGE, maxResidentPages: 3 });
  for (let i = 0; i < 4; i++) f.arrive(`p${i}`);
  f.pool.trim();
  assert.deepEqual(f.dropped, ['p0']);
  assert.equal(f.state.allocationBytes, 3 * PAGE);
});

// #839: the residency's work per image follows the view — what it asks for and draws —, never the
// world, its root cover or what the pool holds.
test('an image costs the residency the same work in a world sixteen times larger', () => {
  const imageWork = (scale: number) => {
    const f = fixture(1000 * scale, { budgetBytes: 40 * PAGE, rootPages: 10 * scale });
    for (let i = 0; i < 60; i++) f.arrive(`p${i * scale}`);
    const asked = Array.from({ length: 8 }, (_, i) => `p${i * scale}`);
    f.keep(asked, asked);
    f.pool.trim();
    const before = f.work();
    f.keep(asked, asked);
    f.pool.trim();
    return f.work() - before;
  };
  const small = imageWork(1);
  assert.ok(small > 0 && small <= 3 * 8, `${small} reads for eight pages asked for`);
  assert.equal(imageWork(16), small);
});

test('a page gives back the parents it held, even once its parents read otherwise', () => {
  const parents: Record<string, string[]> = { p1: ['p0'] };
  const f = fixture(10, { budgetBytes: PAGE, parents });
  f.arrive('p0');
  f.keep(['p1']);
  f.pool.trim();
  // The placement is laid out elsewhere: p1 now reads no parent, yet p0 is still its to give back.
  parents.p1 = [];
  f.keep([]);
  for (let i = 0; i < 3; i++) f.pool.trim();
  f.arrive('p2');
  f.pool.trim();
  assert.deepEqual(f.dropped, ['p0'], 'p0 was released, and leaves before the newer p2');
});

// #839: the residency's tables follow the view, never every page it ever asked for.
test('a view sliding across a large world keeps as many keys as it holds', () => {
  const f = fixture(4000, { budgetBytes: 40 * PAGE });
  let most = 0;
  for (let from = 0; from < 3000; from += 5) {
    const view = Array.from({ length: 20 }, (_, i) => `p${from + i}`);
    f.keep(view, view);
    f.pool.trim();
    for (const url of view) if (!f.resident.has(url)) f.arrive(url);
    most = Math.max(most, f.pool.keyCount);
  }
  assert.ok(most <= 2 * 20, `${most} keys for a view of 20 pages`);
});
