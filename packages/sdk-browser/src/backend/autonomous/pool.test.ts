import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PAGE } from './pool.fixture.ts';

test('under its budget the pool walks nothing: an arrival only enters the order', () => {
  const f = fixture(10, { budgetBytes: 5 * PAGE });
  for (let i = 0; i < 5; i++) f.arrive(`p${i}`);
  f.pool.trim();
  assert.equal(f.keptCalls(), 0);
  assert.equal(f.rootReads(), 0);
  assert.deepEqual(f.dropped, []);
  assert.equal(f.pool.held.budgetBytes, 5 * PAGE);
  assert.equal(f.pool.held.slots, 5);
});

test('over its budget the pool sheds the oldest pages no cut keeps, never a kept one', () => {
  const f = fixture(10, { budgetBytes: 3 * PAGE });
  f.kept.add('p0');
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.pool.trim();
  f.arrive('p3');
  // p0 is the oldest but kept: p1 leaves in its place, and the page that just arrived stays.
  assert.deepEqual(f.dropped, ['p1']);
  assert.ok(f.state.allocationBytes <= 3 * PAGE);
  // The order is that of arrivals, not of the images that kept a page: once released, p0 goes.
  f.kept.clear();
  f.pool.trim();
  f.arrive('p4');
  assert.deepEqual(f.dropped, ['p1', 'p0']);
  assert.deepEqual([...f.resident].sort(), ['p2', 'p3', 'p4']);
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

test('when what is kept fills the budget, arrivals stay and nothing is walked again', () => {
  const f = fixture(100, { budgetBytes: 2 * PAGE });
  for (const url of ['p0', 'p1', 'p2']) f.kept.add(url);
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.pool.trim();
  const calls = f.keptCalls();
  // A burst of arrivals the cut has not asked for yet: none is evicted on arrival, and the kept
  // set is not rebuilt for each.
  for (let i = 3; i < 50; i++) f.arrive(`p${i}`);
  assert.deepEqual(f.dropped, [], 'a drawn page is never evicted, an arrival not on arrival');
  assert.equal(f.keptCalls(), calls);
  // The next cut draws a coarser cover: what it left goes, oldest first, down to the budget.
  f.kept.clear();
  f.kept.add('p49');
  assert.equal(f.pool.trim(), 48);
  assert.equal(f.state.allocationBytes, 2 * PAGE);
  assert.equal(f.keptCalls(), calls + 1);
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
  f.kept.add('p5');
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
