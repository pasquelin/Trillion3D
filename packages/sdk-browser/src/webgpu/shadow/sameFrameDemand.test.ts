// The early demand (#1209): the pages a frame's receivers read are known before its shadow raster,
// so a page first needed this frame is drawn before this frame samples it, and the scheduler needs
// no readback — what it maps and draws is what the readback path maps and draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INDEX_MASK } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  LAMP,
  SUN,
  VIEW,
  planFrame,
  report,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { frustumExcludesBox } from '../../../../sdk-core/src/index.ts';
import { SHADOW_WGSL } from '../../lighting/direct/shadowBias.fixture.ts';
import { READ, floorTiles, shadingReads, tileGrid, viewPlanes } from './demand.fixture.ts';
import { LAMP_AHEAD, MAX, MIN, demandScene, readable, receiversOf } from './demandScene.fixture.ts';

const TILES = tileGrid(-4, 4, -16, -8);

test('the shading read the demand is proved against is the WGSL one', () => {
  for (const line of READ) assert.ok(SHADOW_WGSL.includes(line), line);
});

test('a page first needed this frame is drawn before this frame samples it', () => {
  const { store, plan } = demandScene([LAMP_AHEAD]);
  for (let frame = 1; frame < 12; frame++) {
    store.set('lamp', { position: [frame / 4, 3, -12] });
    // New receivers enter the view at frame 6: their pages were never asked before.
    const tiles = floorTiles(frame < 6 ? TILES : [...TILES, ...tileGrid(4, 6, -12, -10)]);
    plan.plan(store, VIEW, MIN, MAX, frame, frame * 16, receiversOf(tiles.boxes));
    const drawn = new Set(plan.admission.list.subarray(0, plan.admission.count));
    plan.commit();
    const reads = shadingReads(plan, store, VIEW, VIEW.pixelNear, tiles.lits);
    assert.ok(reads.length > 0);
    for (const entry of reads) {
      assert.ok(readable(plan, entry), `entry ${entry} read at frame ${frame}`);
      const page = plan.table.words[entry] & PAGE_INDEX_MASK;
      assert.ok(drawn.has(page), `page ${page} read at frame ${frame} drawn at the new pose`);
    }
  }
});

test('with the readback withheld, page identity and validity equal the readback path', () => {
  const { lits, boxes } = floorTiles(TILES);
  for (const lights of [[LAMP_AHEAD], [SUN], [SUN, LAMP_AHEAD]]) {
    const back = demandScene(lights),
      early = demandScene(lights);
    for (let frame = 1; frame < 6; frame++) {
      planFrame(back.plan, back.store, frame);
      back.plan.commit();
      report(
        back.plan,
        back.store,
        frame,
        shadingReads(back.plan, back.store, VIEW, VIEW.pixelNear, lits),
      );
      early.plan.plan(early.store, VIEW, MIN, MAX, frame, frame * 16, receiversOf(boxes));
      early.plan.commit();
      // No frame late: the demand's first frame already reads every page drawn.
      for (const entry of shadingReads(early.plan, early.store, VIEW, VIEW.pixelNear, lits))
        assert.ok(
          readable(early.plan, entry),
          `${lights.length} lights: entry ${entry} at ${frame}`,
        );
    }
    const reads = shadingReads(back.plan, back.store, VIEW, VIEW.pixelNear, lits);
    assert.deepEqual(shadingReads(early.plan, early.store, VIEW, VIEW.pixelNear, lits), reads);
    for (const entry of reads) {
      assert.ok(readable(back.plan, entry) && readable(early.plan, entry), `entry ${entry}`);
      const a = back.plan.table.words[entry] & PAGE_INDEX_MASK,
        b = early.plan.table.words[entry] & PAGE_INDEX_MASK;
      for (const [{ pool }, page] of [
        [back.plan, a],
        [early.plan, b],
      ] as const)
        assert.equal(pool.owner[page], entry, `page ${page} holds entry ${entry}`);
      for (const key of ['slice', 'view', 'x', 'y', 'rank', 'valid'] as const)
        assert.equal(back.plan.pool[key][a], early.plan.pool[key][b], `${key} of entry ${entry}`);
    }
  }
});

test('an off-camera caster over a visible receiver keeps its pages', () => {
  // A lamp and a caster left of the view, the caster's shadow on visible floor at x ≈ −4.
  const { store, plan } = demandScene([{ ...LAMP, position: [-20, 4, -12] }]);
  const planes = viewPlanes(VIEW),
    tiles = floorTiles(tileGrid(-8, -2, -14, -10));
  const casterAt = (z: number) => [
    [-16.5, 2.5, z - 0.5],
    [-15.5, 3.5, z + 0.5],
  ];
  const [lo, hi] = casterAt(-12);
  assert.ok(frustumExcludesBox(planes, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]), 'off camera');
  const plan1 = (frame: number) => {
    plan.plan(store, VIEW, MIN, MAX, frame, frame * 16, receiversOf(tiles.boxes));
    const drawn = new Set(plan.admission.list.subarray(0, plan.admission.count));
    plan.commit();
    return drawn;
  };
  for (let frame = 1; frame < 4; frame++) plan1(frame);
  const reads = shadingReads(plan, store, VIEW, VIEW.pixelNear, tiles.lits);
  const pagesOf = () => reads.map((entry) => plan.table.words[entry] & PAGE_INDEX_MASK);
  const kept = pagesOf();
  for (let frame = 4; frame < 12; frame++) {
    const [a] = casterAt(-12 + (frame - 4) / 10),
      [, b] = casterAt(-12 + (frame - 3) / 10);
    plan.worldChanged(a, b);
    const drawn = plan1(frame);
    assert.ok(
      kept.some((page) => drawn.has(page)),
      `the caster's move redraws a page the floor reads at frame ${frame}`,
    );
    assert.ok(
      reads.every((entry) => readable(plan, entry)),
      `every page read at frame ${frame}`,
    );
    assert.deepEqual(pagesOf(), kept, `the floor keeps its pages at frame ${frame}`);
  }
});
