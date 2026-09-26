// #525: each mover stales only the pages its own box covers, in each light view — a sun level, a
// lamp face at a mip —, however many move at once; and finding them costs the pages covered, never
// the pool. The shape is the walker's: small balls far apart around a point lamp, under a sun.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SceneLight } from '../light/contracts.ts';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowChanges } from './changes.ts';
import { writeFace } from './faces.ts';
import { createShadowPlan, type ShadowPlan } from './plan.ts';
import { LAMP_MIPS, lampEntry, lampPagesAt } from './virtual.ts';
import { SUN, cycle, planFrame, sunPages } from './lightShadow.fixture.ts';

const LAMP: SceneLight = { ...SUN, id: 'lamp', kind: 'point', position: [0, 3, 0], range: 20 };
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
  const lamp = plan.table.baseOf(store.sliceOf(0)),
    sun = store.sliceOf(1),
    read: number[] = [];
  for (let face = 0; face < 6; face++)
    for (const mip of [2, 4])
      for (let y = 0; y < lampPagesAt(mip); y++)
        for (let x = 0; x < lampPagesAt(mip); x++) read.push(lamp + lampEntry(face, mip, x, y));
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
  assert.deepEqual(
    staleEntries(plan),
    [...own].sort((a, b) => a - b),
    'the union of their own',
  );
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
    for (let i = 0; i <= steps ** 3 + steps ** 2 + steps; i++) {
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

test("a point lamp's faces and mips are staled by overlap only: a face the box is behind keeps", () => {
  const { store, plan, frame } = settled(32);
  const min = [6, 0.25, -0.25],
    max = [6.5, 0.75, 0.25];
  plan.worldChanged(min, max, true);
  planFrame(plan, store, frame);
  const landed = landedPages(min, max),
    { pool } = plan,
    slice = store.sliceOf(0),
    staled = new Set<string>();
  for (let page = 0; page < pool.pages; page++) {
    if (pool.owner[page] < 0 || pool.slice[page] !== slice || !pool.dirty[page]) continue;
    const key = pool.view[page];
    staled.add(`${key >> 4}:${key & 15}:${pool.x[page]}:${pool.y[page]}`);
  }
  assert.ok(staled.size > 0);
  for (const key of staled) {
    const [face, mip, x, y] = key.split(':').map(Number);
    const near = [-1, 0, 1].some((dx) =>
      [-1, 0, 1].some((dy) => landed.has(`${face}:${mip}:${x + dx}:${y + dy}`)),
    );
    assert.ok(near, `page ${key} lies off the box's own pages`);
  }
  for (let page = 0; page < pool.pages; page++) {
    if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
    const key = pool.view[page],
      at = `${key >> 4}:${key & 15}:${pool.x[page]}:${pool.y[page]}`;
    if (landed.has(at)) assert.ok(staled.has(at), `page ${at} under the box is not staled`);
  }
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
