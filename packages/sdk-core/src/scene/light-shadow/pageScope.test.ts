// #525: a shadow page costs only what the view reads. A page no receiver on screen reads is never
// mapped, so never drawn; and the list a frame draws from serves each light's coarse coverage
// first, so a moving frame's budget lands where every finer page falls back. That a page draws
// only the casters its own square meets is held beside the shader (`gpu/shadow/cullShader.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_MAPPED, sunFloorLevel } from './virtual.ts';
import {
  SUN,
  cycle,
  nudged,
  planFrame,
  report,
  sunGrid,
  sunPages,
  sunScene,
} from './lightShadow.fixture.ts';

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
  const { pool } = plan;
  for (let frame = 1; frame < 12; frame++) {
    store.set(SUN.id, { direction: [frame / 1000, -1, 0] });
    cycle(plan, store, frame, () => sunGrid(plan, slice, [2, 3]), nudged(frame));
    if (frame > 1) assert.ok(plan.counts.pendingPages > 0, `frame ${frame}: the budget holds back`);
    for (let page = 0; page < pool.pages; page++)
      if (pool.owner[page] >= 0 && plan.records.isFloor(page))
        assert.ok(pool.valid[page], `frame ${frame}: floor page ${page} is not readable`);
  }
});
