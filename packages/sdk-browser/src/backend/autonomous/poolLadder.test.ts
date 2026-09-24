import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageRec } from '../../page/selection/selection.ts';
import { fixture, PAGE, records } from './pool.fixture.ts';

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

test('the ladder weighs page copies, not records: records sharing a geometry count once', () => {
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

test('a raised budget brings the detail back on a still view: the pool asks for images until it settles', () => {
  const f = fixture(100, { budgetBytes: 10 * PAGE, ceilingBytes: 40 * PAGE });
  const { pool } = f;
  // Finer than 1 px the view asks for 20 pages; at 1 px and coarser, 4.
  const cut = (threshold: number) => records(threshold >= 1 ? 4 : 20);
  // One image, then another only while the pool asks for it: the frame scheduler's loop.
  const settle = () => {
    let images = 0;
    do {
      const threshold = pool.threshold(0);
      pool.admit(0, threshold, 1, cut(threshold), cut(threshold));
      images++;
    } while (pool.settling && images < 100);
    return images;
  };
  settle();
  assert.equal(pool.budgetPixelError, 1, 'the small budget settles one rung up');
  assert.equal(pool.settling, false);
  // A budget the full cut fits: nothing moves the camera, yet the floor comes down to 0.
  pool.resize(40 * PAGE);
  const images = settle();
  assert.ok(images > 1, 'more than the one image the budget change drew');
  assert.equal(pool.budgetPixelError, 0);
  assert.equal(pool.settling, false);
});

test('the slots count geometry copies: a page three instances hold fills three', () => {
  const f = fixture(100, { budgetBytes: 10 * PAGE, copies: 3 });
  // Four distinct pages fit ten slots, their twelve copies do not.
  assert.equal(f.pool.admit(0, 0, 1, records(4), records(4)), true);
  assert.equal(f.pool.coverageBudgetLimited, true);
  // A scene whose pages fit alone does not once instances multiply them: the pool is drawn again.
  const g = fixture(4, { budgetBytes: 10 * PAGE });
  assert.equal(g.pool.held.clamp, 'scene');
  assert.equal(g.pool.held.slots, 4);
  g.instances(3);
  assert.equal(g.pool.held.clamp, null);
  assert.equal(g.pool.held.slots, 10);
  assert.equal(g.pool.admit(0, 0, 1, records(4), records(4)), true);
});

test('a verdict that changes is published once, as coverage-budget', () => {
  const f = fixture(100, { budgetBytes: 10 * PAGE });
  f.pool.admit(0, 0, 1, records(20), records(20));
  f.pool.admit(0, 1, 1, records(20), records(20));
  f.pool.admit(0, 2, 1, records(4), records(4));
  const published = f.diagnostics.map(({ phase, context }) => [phase, context?.limited]);
  assert.deepEqual(published, [
    ['coverage-budget', true],
    ['coverage-budget', false],
  ]);
  assert.equal(f.diagnostics[0].context?.requiredSlots, 20);
  assert.equal(f.diagnostics[0].context?.pipelineVersion, 1);
});

test('a cut that draws the root cover counts it once, from its size', () => {
  const f = fixture(100, { budgetBytes: 10 * PAGE, rootPages: 6 });
  const roots = Array.from({ length: 6 }, (_, i) => ({ url: `r${i}` }) as PageRec);
  // Six roots and four pages fit ten slots, however many records name the roots.
  const cut = [...roots, ...roots, ...records(4)];
  assert.equal(f.pool.admit(0, 0, 1, cut, cut), false);
  assert.equal(f.pool.coverageBudgetLimited, false);
  // A root page that arrives stays outside the order: nothing ever tries to evict it.
  f.arrive('r0');
  for (let i = 0; i < 12; i++) f.arrive(`p${i}`);
  f.pool.trim();
  assert.ok(!f.dropped.includes('r0'));
});
