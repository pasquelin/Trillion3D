// The frustum verdict through the box tree (#981) against develop's item-by-item ranking
// (`hierarchyOracle.fixture.ts`): the audit's CPU-17 equivalence harness, ported.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { surfaceOf } from '../../page/surface.ts';
import { notDrawn } from '../../placement/hidden.ts';
import type { PlacementOf } from '../../placement/rows.ts';
import { refreshBlendBoxes } from './hierarchy.ts';
import { developOrder, outcome } from './hierarchyOracle.fixture.ts';
import { orderBlendPasses } from './order.ts';
import { buildBlendStatics, refreshBlendPlan } from './plan.ts';
import { blendSceneOf } from './plan.fixture.ts';
import type { BlendGpuItem } from './state.ts';

const EDGES = [NaN, Infinity, -Infinity, -0, 0, Number.MAX_VALUE, -Number.MAX_VALUE];

/** A random box in a wide world; `edges` sometimes writes a special value into it. */
function box(next: () => number, edges: boolean) {
  const x = (next() - 0.5) * 200,
    y = (next() - 0.5) * 200,
    z = (next() - 0.5) * 200,
    r = next() * 4;
  const bounds = new Float64Array([x - r, y - r, z - r, x + r, y + r, z + r]);
  if (edges && next() < 0.05)
    bounds[Math.floor(next() * 6)] = EDGES[Math.floor(next() * EDGES.length)];
  return bounds;
}

/** Six planes keeping the axis box of half-size `r` around `c`; `tilt` draws random normals. */
function viewBox(into: Float64Array, c: number[], r: number, tilt?: () => number) {
  for (let p = 0; p < 6; p++) {
    const axis = p >> 1,
      sign = p & 1 ? -1 : 1;
    const n = tilt ? [tilt() - 0.5, tilt() - 0.5, tilt() - 0.5] : [0, 0, 0];
    if (!tilt) n[axis] = sign;
    into.set([n[0], n[1], n[2], r - sign * c[axis]], p * 4);
  }
}

/** A view around a random centre, or random half-spaces; `edges` may write a special value. */
function planes(into: Float64Array, next: () => number, edges: boolean) {
  const c = [0, 1, 2].map(() => (next() - 0.5) * 150),
    r = 5 + next() * 60;
  viewBox(into, c, r, next() < 0.3 ? next : undefined);
  if (edges && next() < 0.2)
    into[Math.floor(next() * 24)] = EDGES[Math.floor(next() * EDGES.length)];
}

function scene(count: number, next: () => number, edges: boolean) {
  const items: BlendGpuItem[] = [];
  for (let i = 0; i < count; i++)
    items.push({
      surface: surfaceOf(G.basicSurface({ side: Math.floor(next() * 3) })),
      matrix: new G.Matrix4().makeTranslation(next() * 50, 0, next() * 50),
      count: 3,
      paged: next() < 0.7,
      transmissive: next() < 0.2,
      bounds: next() < 0.9 ? box(next, edges) : undefined,
      placement: { rows: { live: new Uint8Array([1]) }, index: 0 } as unknown as PlacementOf,
    } as unknown as BlendGpuItem);
  return items;
}

/** Frames of camera, frustum, box, visibility and plan events, both states checked each frame.
 *  Returns the item verdicts compared. */
function walk(count: number, seed: number, frames: number, edges = false) {
  const next = random(seed),
    items = scene(count, next, edges);
  const tree = blendSceneOf(items),
    oracle = blendSceneOf(items);
  let eye = [0, 0, 0];
  for (let frame = 0; frame < frames; frame++) {
    const roll = next();
    if (roll < 0.3) eye = eye.map((v) => v + (next() - 0.5) * 10);
    else if (roll < 0.4)
      eye = eye.map(() => (edges && next() < 0.3 ? EDGES[frame % EDGES.length] : 0));
    if (next() < 0.7) planes(tree.blendPlanes, next, edges);
    oracle.blendPlanes.set(tree.blendPlanes);
    for (let moves = count && Math.floor(next() * 8); moves > 0; moves--) {
      const item = items[Math.floor(next() * count)],
        what = next();
      if (what < 0.6) item.bounds = box(next, edges);
      else if (what < 0.7) item.bounds = undefined;
      else if (what < 0.85) item.hidden = !item.hidden;
      else item.placement!.rows.live[0] ^= 1;
    }
    // A move is refit where production refreshes boxes (`render.ts`).
    refreshBlendBoxes(tree);
    if (next() < 0.05)
      for (const state of [tree, oracle]) {
        buildBlendStatics(state);
        refreshBlendPlan(state);
      }
    const kept = outcome(tree, orderBlendPasses(tree, eye));
    assert.deepEqual(
      kept,
      outcome(oracle, developOrder(oracle, eye)),
      `seed ${seed}, frame ${frame}`,
    );
  }
  return count * frames;
}

test('random scenes: kept set, counts and order word for word develop, over 10 000 verdicts', () => {
  let verdicts = 0;
  for (let seed = 1; seed <= 12; seed++) verdicts += walk(300, seed, 30);
  assert.ok(verdicts >= 10_000);
});

test('NaN, signed zero and infinite boxes, planes and eyes change no verdict', () => {
  for (let seed = 101; seed <= 112; seed++) walk(300, seed, 30, true);
});

test('empty, word-edge and maximal scenes', () => {
  for (const count of [0, 1, 31, 32, 33, 64]) walk(count, 200 + count, 10, true);
  walk(20_000, 299, 4);
});

test('an off-screen cluster is rejected by its nodes, not box by box', () => {
  const next = random(401),
    items = scene(4000, next, false);
  const blendState = blendSceneOf(items);
  // A view of 20 units at a corner of the 200-unit world.
  viewBox(blendState.blendPlanes, [90, 90, 90], 10);
  orderBlendPasses(blendState, [90, 90, 90]);
  assert.ok(blendState.hierarchy.tested < items.length / 4, `${blendState.hierarchy.tested} boxes`);
});

test('a box moved into view is kept once the tree is refit', () => {
  const next = random(501),
    items = scene(500, next, false);
  const blendState = blendSceneOf(items);
  // Five planes pass the whole space; the sixth keeps x >= 150 only, where no item starts.
  for (let p = 0; p < 6; p++) blendState.blendPlanes.set([0, 0, 0, 1], p * 4);
  blendState.blendPlanes.set([1, 0, 0, -150]);
  orderBlendPasses(blendState, [0, 0, 0]);
  const item = items.find((entry) => entry.bounds && !notDrawn(entry))!;
  item.bounds = new Float64Array([200, 0, 0, 201, 1, 1]);
  refreshBlendBoxes(blendState);
  orderBlendPasses(blendState, [0, 0, 1]);
  assert.ok(blendState.keepPacked[item.orderRank >>> 5] & (1 << (item.orderRank & 31)));
});
