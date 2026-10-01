import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { surfaceOf } from '../../page/surface.ts';
import { orderBlendPasses } from './order.ts';
import { buildBlendStatics, planItem, refreshBlendPlan } from './plan.ts';
import { blendSceneOf } from './plan.fixture.ts';
import { resliceBlendRuns } from './runs.ts';
import { RUN_WORDS } from './planLayout.ts';
import { buildBlendRuns } from './runSlicing.ts';
import { precedes, sortPlanFarToNear } from './sortPlan.ts';
import type { BlendGpuItem } from './state.ts';

type BlendState = ReturnType<typeof blendSceneOf>;

/**
 * The ranking `develop` did before the shift budget: insertion on the previous frame's order,
 * then the runs sliced whole. Every frame below must match it word for word.
 */
function developRanking(previous: Uint32Array, items: readonly BlendGpuItem[]) {
  const order = previous.slice();
  for (let i = 1; i < order.length; i++) {
    const entry = order[i],
      moved = items[planItem(entry)];
    let j = i - 1;
    for (; j >= 0; j--) {
      const held = items[planItem(order[j])];
      if (!precedes(held.orderKey, held.orderRank, moved.orderKey, moved.orderRank)) break;
      order[j + 1] = order[j];
    }
    order[j + 1] = entry;
  }
  const runs = new Uint32Array(Math.max(1, order.length) * RUN_WORDS);
  const count = buildBlendRuns(order, runs);
  return { order: Array.from(order), runs: Array.from(runs.subarray(0, count * RUN_WORDS)) };
}

/** A frame ranked by `orderBlendPasses`, checked against `developRanking` on both passes. */
function rankAndCheck(blendState: BlendState, eye: number[], what: string) {
  const previous = blendState.orders.map((order) => order.slice());
  orderBlendPasses(blendState, eye);
  for (let pass = 0; pass < previous.length; pass++) {
    const expected = developRanking(previous[pass], blendState.blendGpu);
    const count = blendState.runCount[pass];
    assert.deepEqual(
      {
        order: Array.from(blendState.orders[pass]),
        runs: Array.from(blendState.runs[pass].subarray(0, count * RUN_WORDS)),
      },
      expected,
      `${what}, pass ${pass}`,
    );
  }
}

const SIDES = [0, 1, 2];
const EDGES = [NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE];

/** Items on a coarse grid, so equal keys are common; `edges` puts special values in some boxes. */
function scene(count: number, seed: number, edges = false) {
  const next = random(seed);
  const pick = (n: number) => Math.floor(next() * n);
  const items: BlendGpuItem[] = [];
  for (let i = 0; i < count; i++) {
    const x = pick(7) - 3,
      y = pick(7) - 3,
      z = pick(7) - 3;
    const bounds = new Float64Array([x - 1, y - 1, z - 1, x + 1, y + 1, z + 1]);
    if (edges && next() < 0.2) bounds[pick(6)] = EDGES[pick(EDGES.length)];
    const matrix = new G.Matrix4().makeTranslation(x, y, z);
    items.push({
      surface: surfaceOf(G.basicSurface({ side: SIDES[pick(3)] })),
      matrix,
      count: 3,
      paged: next() < 0.7,
      transmissive: next() < 0.2,
      bounds: next() < 0.9 ? bounds : undefined,
    } as unknown as BlendGpuItem);
  }
  const blendState = blendSceneOf(items);
  // Rejects nothing: every plane passes the whole space.
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4);
  return { blendState, next };
}

/** Frames of small steps, camera jumps, and the events that void or replace the runs. */
function walk(count: number, seed: number, frames: number, edges = false) {
  const { blendState, next } = scene(count, seed, edges);
  let eye = [0, 0, 0];
  for (let frame = 0; frame < frames; frame++) {
    const roll = next();
    if (roll < 0.35) eye = eye.map((v) => v + Math.round((next() - 0.5) * 2));
    else if (roll < 0.6) eye = [0, 1, 2].map(() => Math.round((next() - 0.5) * 40));
    else if (roll < 0.65) orderBlendPasses(blendState, undefined);
    else if (roll < 0.7) refreshBlendPlan(blendState);
    else if (roll < 0.75) {
      // New runs buffers under the same orders: a remount, which asks for an upload.
      buildBlendStatics(blendState);
      blendState.orderMoved = [true, true];
    } else if (roll < 0.85) blendState.orderMoved = [false, false];
    rankAndCheck(blendState, eye, `seed ${seed}, frame ${frame}`);
  }
}

test('ranking is word for word the insertion order, runs included, on random walks', () => {
  for (let seed = 1; seed <= 12; seed++) walk(60, seed, 40);
});

test('a camera jump past the shift budget gives the same order as insertion', () => {
  // Hundreds of entries: a jump costs far more than eight shifts per entry.
  for (let seed = 21; seed <= 24; seed++) walk(600, seed, 12);
});

test('NaN, infinite, signed zero and huge keys give the same order as insertion', () => {
  for (let seed = 31; seed <= 40; seed++) walk(300, seed, 16, true);
});

test('a NaN key keeps pure insertion, even on a jump', () => {
  const { blendState } = scene(400, 41);
  blendState.blendGpu[7].bounds = new Float64Array([-Infinity, 0, 0, Infinity, 0, 0]);
  rankAndCheck(blendState, [30, 30, 30], 'far eye');
  rankAndCheck(blendState, [-30, -30, -30], 'jump through the scene');
});

test('empty, single-item and single-pass scenes', () => {
  for (const count of [1, 2, 3]) walk(count, 50 + count, 8);
  const blendState = blendSceneOf([]);
  assert.equal(orderBlendPasses(blendState, [0, 0, 0]), 0);
  assert.deepEqual(blendState.runCount, [0, 0]);
});

test('runs resliced from any entry equal runs sliced whole', () => {
  const next = random(61);
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(next() * 40);
    // Pipelines 0-1 and the share bit, so runs of every length appear.
    const entries = () =>
      Uint32Array.from(
        { length: n },
        (_, i) => (i << 6) | (next() < 0.8 ? 16 : 0) | (next() < 0.3 ? 1 : 0),
      );
    const before = entries(),
      runs = new Uint32Array(n * RUN_WORDS),
      count = buildBlendRuns(before, runs);
    const at = Math.floor(next() * (n + 1)),
      after = before.slice();
    after.set(entries().subarray(at), at);
    const expected = new Uint32Array(n * RUN_WORDS);
    const whole = buildBlendRuns(after, expected);
    assert.equal(resliceBlendRuns(after, runs, count, at), whole, `trial ${trial}`);
    assert.deepEqual(runs.subarray(0, whole * RUN_WORDS), expected.subarray(0, whole * RUN_WORDS));
  }
});

test('the sort names an entry at or before the first it changed, merge fallback included', () => {
  const check = (keys: number[], order: number[], what: string) => {
    const items = keys.map((orderKey, orderRank) => ({ orderKey, orderRank }) as BlendGpuItem);
    const before = Uint32Array.from(order, (rank) => rank << 6),
      after = before.slice();
    const first = sortPlanFarToNear(after, Float64Array.from(keys));
    assert.deepEqual(Array.from(after), developRanking(before, items).order, what);
    const changed = after.findIndex((entry, i) => entry !== before[i]);
    assert.ok(first <= (changed < 0 ? after.length : changed), `${what}: ${first} > ${changed}`);
  };
  // A sorted head, a reversed middle that spends the budget, then a tail due at the very front.
  const keys = [
    ...Array.from({ length: 10 }, (_, i) => 1000 - i),
    ...Array.from({ length: 380 }, (_, i) => i + 1),
    ...Array.from({ length: 10 }, () => 5000),
  ];
  check(
    keys,
    keys.map((_, rank) => rank),
    'late jump',
  );
  const next = random(71);
  for (let trial = 0; trial < 50; trial++) {
    const n = 1 + Math.floor(next() * 500),
      shuffled = Array.from({ length: n }, (_, rank) => rank);
    // Mostly sorted, with a random stretch shuffled: from a few shifts to past the budget.
    const from = Math.floor(next() * n),
      to = from + Math.floor(next() * (n - from));
    for (let i = to; i > from; i--) {
      const j = from + Math.floor(next() * (i - from + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    check(
      Array.from({ length: n }, (_, rank) => n - rank - (rank % 3)),
      shuffled,
      `trial ${trial}`,
    );
  }
});
