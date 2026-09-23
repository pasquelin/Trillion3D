import test from 'node:test';
import assert from 'node:assert/strict';
import type { GeometryPageDescriptor } from '../../../../sdk-core/src/index.ts';
import { createGeometryBudget } from './pool.ts';

const PAGE = 100;

/** A catalogue of `count` pages of `PAGE` decoded bytes, and a store that holds what arrives. */
function fixture(count: number, budgetBytes?: number, rootPages = 1) {
  const descriptors = new Map<string, GeometryPageDescriptor>();
  for (let i = 0; i < count; i++)
    descriptors.set(`p${i}`, { uncompressedBytes: PAGE } as GeometryPageDescriptor);
  const state = { allocationBytes: 0 },
    resident = new Set<string>(),
    kept: string[] = [],
    dropped: string[] = [];
  let keptCalls = 0;
  const pool = createGeometryBudget({
    budgetBytes,
    descriptors,
    rootPages,
    state,
    kept: () => {
      keptCalls++;
      return kept;
    },
    drop: (url) => {
      if (!resident.delete(url)) return;
      state.allocationBytes -= PAGE;
      dropped.push(url);
    },
  });
  const arrive = (url: string) => {
    resident.add(url);
    state.allocationBytes += PAGE;
    pool.arrived(url);
  };
  return { pool, state, resident, kept, dropped, arrive, keptCalls: () => keptCalls };
}

test('under its budget the pool walks nothing: an arrival only enters the order', () => {
  const f = fixture(10, 5 * PAGE);
  for (let i = 0; i < 5; i++) f.arrive(`p${i}`);
  f.pool.trim();
  assert.equal(f.keptCalls(), 0);
  assert.deepEqual(f.dropped, []);
  assert.equal(f.pool.held.budgetBytes, 5 * PAGE);
  assert.equal(f.pool.held.slots, 5);
  assert.equal(f.pool.cutPages, 5);
});

test('over its budget the pool sheds the oldest pages no frame keeps, never a kept one', () => {
  const f = fixture(10, 3 * PAGE);
  f.kept.push('p0');
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  f.arrive('p3');
  // p0 is the oldest but kept: p1 leaves in its place.
  assert.deepEqual(f.dropped, ['p1']);
  assert.ok(f.state.allocationBytes <= 3 * PAGE);
  // Kept at the last pass, p0 became the most recent: once released, p2 and p3 go before it.
  f.kept.length = 0;
  f.arrive('p4');
  assert.deepEqual(f.dropped, ['p1', 'p2']);
  assert.deepEqual([...f.resident].sort(), ['p0', 'p3', 'p4']);
});

test('the cut keeping more than the budget holds everything it draws, then sheds after it', () => {
  const f = fixture(10, 2 * PAGE);
  f.kept.push('p0', 'p1', 'p2');
  for (let i = 0; i < 3; i++) f.arrive(`p${i}`);
  assert.deepEqual(f.dropped, [], 'a drawn page is never evicted: no hole');
  assert.equal(f.state.allocationBytes, 3 * PAGE);
  // The next cut draws a coarser cover: what it left goes.
  f.kept.length = 0;
  f.kept.push('p2');
  assert.equal(f.pool.trim(), 1);
  assert.equal(f.state.allocationBytes, 2 * PAGE);
});

test('a budget below the root cover is raised to it, by name', () => {
  const f = fixture(10, PAGE, 3);
  // The root cover is read at prepare, outside the order, and every frame keeps it.
  for (let i = 0; i < 3; i++) {
    f.resident.add(`p${i}`);
    f.state.allocationBytes += PAGE;
    f.kept.push(`p${i}`);
  }
  f.pool.rooted();
  assert.equal(f.pool.held.clamp, 'root-cover');
  assert.equal(f.pool.held.slots, 3);
  f.arrive('p3');
  // Only the page above the root cover's bytes leaves.
  assert.deepEqual(f.dropped, ['p3']);
  assert.equal(f.state.allocationBytes, 3 * PAGE);
});

test('a smaller budget mid-session evicts at once and bounds the next cut', () => {
  const f = fixture(10);
  for (let i = 0; i < 6; i++) f.arrive(`p${i}`);
  assert.equal(f.pool.cutPages, 0, 'the whole scene fits the default pool: the cut is unbounded');
  assert.equal(f.pool.held.clamp, 'scene');
  f.kept.push('p5');
  assert.equal(f.pool.resize(2 * PAGE), 4);
  assert.deepEqual(f.dropped, ['p0', 'p1', 'p2', 'p3']);
  assert.equal(f.pool.cutPages, 2);
  const report = f.pool.report();
  assert.equal(report.budgetBytes, 2 * PAGE);
  assert.equal(report.allocatedBytes, 2 * PAGE, 'the report says what the pages hold');
  assert.throws(() => f.pool.resize(0), /INVALID_GEOMETRY_POOL_BUDGET/);
});

test('a page the streamer evicted leaves the order', () => {
  const f = fixture(10, 2 * PAGE);
  f.arrive('p0');
  f.arrive('p1');
  f.resident.delete('p0');
  f.state.allocationBytes -= PAGE;
  f.pool.left('p0');
  f.arrive('p2');
  f.arrive('p3');
  assert.deepEqual(f.dropped, ['p1']);
});
