// #525: a shadow page costs only what the view reads. A page no receiver on screen reads is never
// mapped, so never drawn; and the list a frame draws from serves each light's coarse coverage
// first, so a frame its memory guard stops still lands where every finer page falls back. That a
// page draws only the casters its own square meets is held beside the shader
// (`gpu/shadow/cullShader.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_MAPPED, sunFloorLevel } from './virtual.ts';
import { SUN, VIEW, planFrame, report, sunPages, sunScene } from './lightShadow.fixture.ts';

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

// A camera that nears a surface lowers the sun's finest level: the pages a level keeps rank as the
// ones it maps after, so the list still holds each view in one run, the coarsest first.
test('a change of the finest level ranks the pages it keeps again: each view stays one run', () => {
  const { store, plan, slice } = sunScene();
  const level = plan.sun.finest[slice] + 3;
  report(
    plan,
    store,
    0,
    sunPages(plan, slice, level, [
      [0, 0],
      [1, 0],
    ]),
  );
  planFrame(plan, store, 1);
  plan.commit();
  const closer = { ...VIEW, pixelNear: VIEW.pixelNear / 2 };
  planFrame(plan, store, 2, closer);
  plan.commit();
  const finer = [
    [0, 0],
    [1, 0],
    [2, 0],
  ];
  report(plan, store, 2, [
    ...sunPages(plan, slice, level, finer),
    ...sunPages(plan, slice, level - 1, finer),
  ]);
  store.set(SUN.id, { direction: [0.05, -1, 0] });
  const count = planFrame(plan, store, 3, closer),
    { keys } = plan.admission;
  const runs = new Set<number>();
  for (let i = 0; i < count; i++) {
    if (i && keys[i] === keys[i - 1]) continue;
    assert.ok(!runs.has(keys[i]), `view ${keys[i]} listed in two runs`);
    runs.add(keys[i]);
  }
});
