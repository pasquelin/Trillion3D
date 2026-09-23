import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, PAGE, records } from './pool.fixture.ts';

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
  f.kept.push('p0');
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.pool.trim();
  f.arrive('p3');
  // p0 is the oldest but kept: p1 leaves in its place, and the page that just arrived stays.
  assert.deepEqual(f.dropped, ['p1']);
  assert.ok(f.state.allocationBytes <= 3 * PAGE);
  // Kept at the last pass, p0 became the most recent: once released, p2 goes before it.
  f.kept.length = 0;
  f.pool.trim();
  f.arrive('p4');
  assert.deepEqual(f.dropped, ['p1', 'p2']);
  assert.deepEqual([...f.resident].sort(), ['p0', 'p3', 'p4']);
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
  f.kept.push('p0', 'p1', 'p2');
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.pool.trim();
  const calls = f.keptCalls();
  // A burst of arrivals the cut has not asked for yet: none is evicted on arrival, and the kept
  // set is not rebuilt for each.
  for (let i = 3; i < 50; i++) f.arrive(`p${i}`);
  assert.deepEqual(f.dropped, [], 'a drawn page is never evicted, an arrival not on arrival');
  assert.equal(f.keptCalls(), calls);
  // The next cut draws a coarser cover: what it left goes, oldest first, down to the budget.
  f.kept.length = 0;
  f.kept.push('p49');
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
  f.kept.push('p5');
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

test('the cut asked for is bounded by the ladder: its floor rises, then settles on a still view', () => {
  const f = fixture(100, { budgetBytes: 10 * PAGE });
  const { pool } = f;
  // Distinct pages the view asks for at each threshold: finer than 0.5 px overflows the 10 slots.
  const cut = (threshold: number) => records(threshold >= 0.5 ? 6 : 20);
  const asked: number[] = [];
  for (let frame = 0; frame < 12; frame++) {
    const threshold = pool.threshold(0);
    asked.push(threshold);
    pool.admit(0, threshold, 1, cut(threshold), cut(threshold));
  }
  // 0 overflows, 1 fits, 0.5 fits, 0.25 overflows and is remembered: the view settles at 0.5.
  assert.deepEqual(asked.slice(0, 6), [0, 1, 0.5, 0.25, 1, 0.5]);
  assert.ok(
    asked.slice(5).every((threshold) => threshold === 0.5),
    'no oscillation',
  );
  assert.equal(pool.budgetPixelError, 0.5);
  assert.equal(pool.coverageBudgetLimited, false);
  // Another view forgets the overflow; a host threshold past the floor gives it up.
  assert.equal(pool.admit(0, 0.5, 2, cut(0.5), cut(0.5)), true);
  assert.equal(pool.threshold(2), 2);
  assert.equal(pool.budgetPixelError, 0);
});

test('the ladder weighs distinct pages, not records: instances of a page count once', () => {
  const f = fixture(100, { budgetBytes: 10 * PAGE });
  // Forty records drawn from eight pages fit ten slots.
  assert.equal(f.pool.admit(0, 0, 1, records(40, 8), records(40, 8)), false);
  assert.equal(f.pool.coverageBudgetLimited, false);
  assert.equal(f.pool.budgetPixelError, 0);
});

test('a pool that holds the whole scene weighs nothing', () => {
  const f = fixture(10);
  assert.equal(f.pool.held.clamp, 'scene');
  assert.equal(f.pool.admit(0, 0, 1, records(400, 10), records(400, 10)), false);
  assert.equal(f.pool.coverageBudgetLimited, false);
});
