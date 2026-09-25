// #525: a shadow page costs only what the view reads and what overlaps it. A page no receiver on
// screen reads is never mapped, so never drawn; a page draws only the casters its own square meets;
// and the list a frame draws from serves each light's coarse coverage first, so a moving frame's
// budget lands where every finer page falls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { writeSunSquare } from './sunFaces.ts';
import { SHADOW_CULL_FLOATS } from './faces.ts';
import { PAGE_MAPPED, sunFloorLevel, sunPageMetres } from './virtual.ts';
import { SUN, VIEW, planFrame, report, sunPages } from './lightShadow.fixture.ts';
import { dotVector3 } from '../../math/primitives/vector.ts';

/** A sun planned once, its floor drawn: the tests' scene. */
function sunScene() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  planFrame(plan, store, 0);
  plan.commit();
  return { store, plan, slice: store.sliceOf(0) };
}

test('a receiver off screen asks for no page: only what the view reads is mapped, and its floor', () => {
  const { store, plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4;
  const onScreen = sunPages(plan, slice, level, [
    [0, 0],
    [1, 0],
  ]);
  // A receiver of the same level twenty pages away, out of the view: no pixel shades it.
  const [offScreen] = sunPages(plan, slice, level, [[20, 20]]);
  report(plan, store, 0, onScreen);
  planFrame(plan, store, 1);
  assert.equal(plan.table.words[offScreen] & PAGE_MAPPED, 0, 'its page is not requested');
  const { pool } = plan,
    floor = sunFloorLevel(plan.sun.finest[slice]);
  for (let page = 0; page < pool.pages; page++)
    if (pool.owner[page] >= 0)
      assert.ok(
        onScreen.includes(pool.owner[page]) || pool.view[page] === floor,
        `page ${page} is neither read nor the floor`,
      );
});

/** The per-region cull's test of a caster's sphere against a sun page's volume, as the shader
 *  runs it (`packages/sdk-browser/src/gpu/shadow/cullShader.ts`, `keepCaster`). */
function keeps(volume: Float32Array, center: number[], radius: number) {
  const delta = [0, 1, 2].map((a) => center[a] - volume[a]);
  const dot = (at: number) => Math.abs(dotVector3(delta, volume, 0, at));
  const gaps = [dot(8) - volume[11], dot(12) - volume[15], dot(4) - volume[3]];
  return gaps.reduce((sum, gap) => sum + Math.max(0, gap) ** 2, 0) <= radius * radius;
}

test("a caster outside a page's square is not drawn into it; one reaching it is", () => {
  const { plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 4,
    size = sunPageMetres(level);
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  writeSunSquare(new Float32Array(16), 0, volume, 0, plan.sun, slice, level, 3, 2);
  const right = plan.sun.frame.subarray(slice * 9, slice * 9 + 3);
  const beside = (pages: number) => [0, 1, 2].map((a) => volume[a] + right[a] * pages * size);
  assert.ok(keeps(volume, beside(0), 0.1 * size), 'a caster inside the page');
  assert.ok(!keeps(volume, beside(1), 0.3 * size), 'a caster over the next page');
  assert.ok(keeps(volume, beside(0.7), 0.3 * size), 'a caster reaching over its edge');
});

test("a frame's list serves each light's coarsest pages first, its floor before all", () => {
  const { store, plan, slice } = sunScene();
  const finest = plan.sun.finest[slice];
  const read = [2, 4, 3].flatMap((step) =>
    sunPages(plan, slice, finest + step, [
      [0, 0],
      [1, 0],
    ]),
  );
  report(plan, store, 0, read);
  // A light that turns stales its floor too: the list holds every level it reads.
  store.set(SUN.id, { direction: [0.1, -1, 0] });
  const count = planFrame(plan, store, 1),
    { list } = plan.admission;
  const levels = [...list.subarray(0, count)].map((page) => plan.pool.view[page]);
  assert.deepEqual(
    levels,
    [...levels].sort((a, b) => b - a),
    'the coarsest level first',
  );
  assert.equal(levels[0], sunFloorLevel(finest));
});

// A sun turning while the camera moves withdraws every page it holds each frame: past the moving
// budget, the finer pages wait, but a reader never loses the shadow — every floor is drawn in the
// frame that marks it, outside the budget, and the finer pages fall back to it.
test('a turning sun under a moving camera keeps its floor current every frame', () => {
  const { store, plan, slice } = sunScene();
  const grid = Array.from({ length: 36 }, (_, k) => [k % 6, Math.floor(k / 6)]);
  const read = () =>
    [2, 3].flatMap((step) => sunPages(plan, slice, plan.sun.finest[slice] + step, grid));
  const { pool } = plan;
  for (let frame = 1; frame < 12; frame++) {
    store.set(SUN.id, { direction: [frame / 1000, -1, 0] });
    const position: [number, number, number] = [frame * 1e-6, 5, 0];
    const count = planFrame(plan, store, frame, { ...VIEW, position });
    const end = plan.admission.frameEnd(plan.resting);
    plan.commit(undefined, 0, end);
    if (end < count) plan.reissue(end);
    if (frame > 1) assert.ok(end < count, `frame ${frame}: the budget holds pages back`);
    for (let page = 0; page < pool.pages; page++)
      if (pool.owner[page] >= 0 && plan.records.isFloor(page))
        assert.ok(pool.valid[page], `frame ${frame}: floor page ${page} is not readable`);
    report(plan, store, frame, read());
  }
});
