// #525: each mover stales only the pages its own box covers, in each light view, however many move
// at once, for the cost of the pages covered. The walker's shape: balls round a point lamp, a sun.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_KIND } from '../light/contracts.ts';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowChanges } from './changes.ts';
import { writeFace } from './faces.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { STALE_DYNAMIC } from './pool.ts';
import { LAMP_MIPS, lampPagesAt, tableEntriesOf } from './virtual.ts';
import { LAMP, SUN, cycle, lampPages, planFrame, sunPages } from './lightShadow.fixture.ts';
/** Twenty-six balls of half a metre on a ring of eight metres round the lamp. */
const BALLS = Array.from({ length: 26 }, (_, i) => {
  const x = 8 * Math.cos((2 * Math.PI * i) / 26),
    z = 8 * Math.sin((2 * Math.PI * i) / 26);
  return { min: [x - 0.25, 0, z - 0.25], max: [x + 0.25, 0.5, z + 0.25] };
});

/** The lamp and the sun, every page the shading reads drawn: the lamp's six faces at mips 2
 *  and 4, and a sun level of two-metre pages over the ring. */
function settled(side: number) {
  const store = createSceneLightStore(),
    plan = createShadowPlan(side);
  store.add(LAMP);
  store.add(SUN);
  planFrame(plan, store, 0);
  const sun = store.sliceOf(1),
    read: number[] = [];
  for (let face = 0; face < 6; face++)
    for (const mip of [2, 4]) read.push(...lampPages(plan, store.sliceOf(0), face, mip));
  const grid = Array.from({ length: 144 }, (_, i) => [(i % 12) - 6, Math.floor(i / 12) - 6]);
  read.push(...sunPages(plan, sun, plan.sun.finest[sun] + 7, grid));
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, () => read);
  return { store, plan, frame };
}

/** Table entries of the stale pages. */
function staleEntries(plan: ShadowPlan) {
  const { pool } = plan,
    entries: number[] = [];
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0 && pool.dirty[page]) entries.push(pool.owner[page]);
  return entries.sort((a, b) => a - b);
}

test('26 small movers far apart stale only the pages their own boxes cover, per light view', () => {
  const own = new Set<number>();
  for (const ball of BALLS) {
    const { store, plan, frame } = settled(32);
    assert.deepEqual(staleEntries(plan), [], 'every page read is drawn');
    plan.worldChanged(ball.min, ball.max);
    planFrame(plan, store, frame);
    for (const entry of staleEntries(plan)) own.add(entry);
  }
  const { store, plan, frame } = settled(32);
  for (const ball of BALLS) plan.worldChanged(ball.min, ball.max);
  planFrame(plan, store, frame);
  assert.deepEqual(new Set(staleEntries(plan)), own, 'the union of their own');
  assert.equal(plan.counts.invalidatedPages, own.size);
  assert.ok(own.size < plan.pool.used() / 2, `${own.size} of ${plan.pool.used()} mapped`);
});

/** `face:mip:x:y` of every lamp page a point of the box lands on, at every mip: the pages the
 *  shading addresses it at. */
function landedPages(min: number[], max: number[]) {
  const matrix = new Float32Array(16),
    keys = new Set<string>(),
    steps = 12;
  for (let face = 0; face < 6; face++) {
    writeFace(matrix, 0, null, 0, LAMP, face);
    for (let i = 0; i < (steps + 1) ** 3; i++) {
      const p = [
        i % (steps + 1),
        Math.floor(i / (steps + 1)) % (steps + 1),
        Math.floor(i / (steps + 1) ** 2),
      ].map((t, a) => min[a] + ((max[a] - min[a]) * t) / steps);
      const clip = [0, 1, 3].map(
        (r) => matrix[r] * p[0] + matrix[4 + r] * p[1] + matrix[8 + r] * p[2] + matrix[12 + r],
      );
      const u = clip[0] / clip[2],
        v = clip[1] / clip[2];
      if (!(clip[2] > 0) || Math.abs(u) > 1 || Math.abs(v) > 1) continue;
      for (let mip = 0; mip < LAMP_MIPS; mip++) {
        const n = lampPagesAt(mip);
        const x = Math.min(n - 1, Math.floor(((u + 1) / 2) * n)),
          y = Math.min(n - 1, Math.floor(((1 - v) / 2) * n));
        keys.add(`${face}:${mip}:${x}:${y}`);
      }
    }
  }
  return keys;
}

/** The pool pages of the lamp in `slice`. */
const lampPagesOf = (plan: ShadowPlan, slice: number) =>
  [...plan.pool.owner.keys()].filter(
    (page) => plan.pool.owner[page] >= 0 && plan.pool.slice[page] === slice,
  );
/** `face:mip:x:y` of a lamp's pool page. */
const pageKey = ({ pool }: ShadowPlan, page: number) =>
  `${pool.view[page] >> 4}:${pool.view[page] & 15}:${pool.x[page]}:${pool.y[page]}`;

test("a point lamp's faces and mips are staled by overlap only: a face the box is behind keeps", () => {
  // Beside the lamp, then across the edge of its +X and +Y faces.
  for (const [min, max] of [
    [
      [6, 0.25, -0.25],
      [6.5, 0.75, 0.25],
    ],
    [
      [3.6, 6.6, -0.4],
      [4.4, 7.4, 0.4],
    ],
  ]) {
    const { store, plan, frame } = settled(32);
    plan.worldChanged(min, max, true);
    planFrame(plan, store, frame);
    const landed = landedPages(min, max),
      pages = lampPagesOf(plan, store.sliceOf(0)),
      staled = new Set(pages.filter((page) => plan.pool.dirty[page]).map((p) => pageKey(plan, p)));
    assert.ok(staled.size > 0);
    for (const key of staled) {
      const [face, mip, x, y] = key.split(':').map(Number);
      const near = [-1, 0, 1].some((dx) =>
        [-1, 0, 1].some((dy) => landed.has(`${face}:${mip}:${x + dx}:${y + dy}`)),
      );
      assert.ok(near, `page ${key} lies off the box's own pages`);
    }
    for (const at of pages.map((page) => pageKey(plan, page)))
      if (landed.has(at)) assert.ok(staled.has(at), `page ${at} under the box is not staled`);
  }
});

test('a spot stales only what lies in front of it: a mover behind or beside its plane keeps', () => {
  const store = createSceneLightStore(),
    plan = createShadowPlan(32);
  store.add({ ...LAMP, kind: 'spot', direction: [0, -1, 0], coneAngle: 0.6 });
  planFrame(plan, store, 0);
  const read = lampPages(plan, store.sliceOf(0), 0, 2);
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, () => read);
  // Above the lamp, and across its plane two metres aside: no caster there reaches its cone.
  plan.worldChanged([-0.25, 4, -0.25], [0.25, 4.5, 0.25], true);
  plan.worldChanged([2, 2.95, -0.1], [2.2, 3.05, 0.1], true);
  planFrame(plan, store, frame);
  assert.equal(plan.counts.invalidatedPages, 0);
});

test('finding the pages a mover stales costs the pages it covers, not the pool', () => {
  const visited = [16, 64].map((side) => {
    const { store, plan, frame } = settled(side);
    plan.worldChanged(BALLS[0].min, BALLS[0].max, true);
    planFrame(plan, store, frame);
    return { visited: plan.counts.visitedPages, mapped: plan.pool.used() };
  });
  assert.ok(visited[0].visited > 0, 'the invalidation counts its work');
  assert.equal(visited[0].visited, visited[1].visited, 'the same work in a pool 16 times larger');
  assert.ok(visited[1].visited < visited[1].mapped / 4, `${visited[1].visited} visited`);
});

test("past a light's virtual pages its boxes join one union per kind: a moving one keeps", () => {
  const { store, plan, frame } = settled(32);
  store.remove(SUN.id); // The lamp alone: its virtual pages, then two unions, not a scan a box.
  // Static casters −X of the lamp, each wider than the pool, then a moving one alone over +X.
  for (let i = 0; i < 12; i++) plan.worldChanged([-40, 0, -40], [-1 - i / 10, 5, 40]);
  plan.worldChanged([1, 0, -40], [40, 5, 40], true);
  planFrame(plan, store, frame);
  const { pool } = plan,
    spare = tableEntriesOf(LIGHT_KIND.point) + 2 * pool.pages - plan.counts.visitedPages;
  assert.ok(spare >= 0 && spare < pool.pages, `a box costs the pool at most: ${spare} spare`);
  const front = lampPagesOf(plan, store.sliceOf(0)).filter((page) => pool.view[page] >> 4 === 0),
    lost = front.filter((page) => pool.dirty[page] !== STALE_DYNAMIC || !pool.valid[page]);
  assert.ok(front.length > 0 && !lost.length, 'the moving one keeps the static layer read');
});

test('a box that bounds nothing finite stales every page of the sun and of the lamp', () => {
  for (const box of [
    [NaN, 0, 0, 1, 1, 1],
    [-Infinity, 0, -Infinity, Infinity, 0.1, Infinity],
  ]) {
    const { store, plan, frame } = settled(32);
    plan.worldChanged(box.slice(0, 3), box.slice(3));
    planFrame(plan, store, frame);
    assert.equal(staleEntries(plan).length, plan.pool.used(), `${box}`);
  }
});

test('past the budget the movers share the last box: a superset of their pages, never fewer', () => {
  const changes = createShadowChanges(2);
  changes.worldChanged([0, 0, 0], [1, 1, 1], true);
  changes.worldChanged([5, 0, 0], [6, 1, 1], true);
  changes.worldChanged([9, 0, 0], [10, 1, 1]);
  assert.equal(changes.count, 2);
  const last = changes.read(1);
  assert.deepEqual([...last.min, ...last.max], [5, 0, 0, 10, 1, 1]);
  assert.equal(last.moving, false, 'a static caster in the union stales the static layer');
  assert.deepEqual([...changes.read(0).max], [1, 1, 1], 'the first box stays its own');
});
