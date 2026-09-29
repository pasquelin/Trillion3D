// What the early demand (#1209) must not miss: a surface no receiver box names, which the
// shading's report names a frame late; the blend pass, which reads at the display's footprint; a
// sun point past its level's window, which reads the next level.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUN,
  VIEW,
  report,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { floorTiles, shadingReads, tileGrid } from './demand.fixture.ts';
import { LAMP_AHEAD, MAX, MIN, demandScene, readable, receiversOf } from './demandScene.fixture.ts';

test("a page only the shading's report names is drawn in the frame that reads the report", () => {
  const { store, plan } = demandScene([LAMP_AHEAD]);
  const boxed = floorTiles(tileGrid(-4, 0, -12, -8)),
    unboxed = floorTiles(tileGrid(2, 4, -14, -12));
  const missed = () => shadingReads(plan, store, VIEW, VIEW.pixelNear, unboxed.lits);
  plan.plan(store, VIEW, MIN, MAX, 1, 16, receiversOf(boxed.boxes));
  plan.commit();
  assert.ok(!missed().every((entry) => readable(plan, entry)), 'no receiver names them');
  report(plan, store, 1, missed());
  plan.plan(store, VIEW, MIN, MAX, 2, 32, receiversOf(boxed.boxes));
  plan.commit();
  for (const entry of missed()) assert.ok(readable(plan, entry), `entry ${entry}`);
});

test("the demand names the levels the blend pass reads at the display's footprint", () => {
  const { store, plan } = demandScene([LAMP_AHEAD, SUN]);
  const { boxes, lits } = floorTiles(tileGrid(-4, 4, -16, -8));
  // The target drawn at a quarter of the display: its pixels four times the display's.
  plan.plan(store, VIEW, MIN, MAX, 1, 16, receiversOf(boxes, VIEW, 4 * VIEW.pixelNear));
  plan.commit();
  for (const pixel of [VIEW.pixelNear, 4 * VIEW.pixelNear])
    for (const entry of shadingReads(plan, store, VIEW, pixel, lits))
      assert.ok(readable(plan, entry), `entry ${entry} at a pixel of ${pixel}`);
});

test("a sun point past its level's window reads the next level, drawn in the frame", () => {
  // A narrow pixel — a 4K canvas zoomed in —: a level's window no longer spans the whole view.
  const view = { ...VIEW, pixelNear: VIEW.pixelNear / 16 };
  const { store, plan } = demandScene([SUN]);
  const { boxes, lits } = floorTiles(tileGrid(24, 30, -44, -40));
  plan.plan(store, view, MIN, MAX, 1, 16, receiversOf(boxes, view));
  plan.commit();
  const reads = shadingReads(plan, store, view, view.pixelNear, lits);
  assert.ok(reads.length > 0);
  for (const entry of reads) assert.ok(readable(plan, entry), `entry ${entry}`);
});
